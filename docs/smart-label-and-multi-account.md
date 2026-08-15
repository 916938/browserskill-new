# 智能标签与多账户管理

本文说明 BrowserSkill 智能标签的实现、配置与重命名流程，以及如何在多个浏览器实例和网站账户之间建立稳定、可读、可维护的管理方案。

## 1. 概念与边界

每个安装 BrowserSkill 扩展的浏览器 Profile 都有两个身份字段：

| 字段 | 示例 | 用途 |
| --- | --- | --- |
| `instance_id` | `03c3e47f` | 稳定且唯一的机器标识，用于连接关联和精确选择 |
| `label` | `Chrome#03c3`、`电商-运营-A` | 面向用户和 Agent 的可读别名 |

标签不是主键，也不是权限或账户隔离边界。多个浏览器可以使用相同标签；发生歧义时，CLI 会要求改用完整 `instance_id`。

网站账户的 Cookie、Local Storage 和登录态由浏览器 Profile 隔离。智能标签只负责标识这个 Profile，不存储账户凭据。

## 2. 默认标签规则

首次连接且没有已保存标签时，扩展自动生成：

```text
{规范化浏览器名称}#{instance_id 前 4 位}
```

示例：

```text
Chrome + 03c3e47f -> Chrome#03c3
Edge   + a7f21b90 -> Edge#a7f2
```

规则：

- 浏览器名去除首尾空格，首字母大写，其余字符转小写。
- 浏览器名为空时使用 `Chrome`。
- ID 少于 4 个字符时使用 `????`，避免生成残缺标签。
- 自动标签只在标签为空时生成；用户重命名后不会在重启时被覆盖。

实现：`apps/extension/src/lib/instance-id.ts:160`。

## 3. 数据结构

### 3.1 扩展本地存储

数据保存在 `chrome.storage.local`：

```typescript
{
  bsk_instance_id: "03c3e47f",
  bh_label: "电商-运营-A",
  bh_connection_enabled: true,
  bsk_control_hints_hidden: false
}
```

标签约束：

- 类型：字符串。
- 保存时去除首尾空格。
- 不能为空。
- 最大长度：32 个 JavaScript 字符。
- 支持中文、英文、数字和常用符号。

读取入口：`apps/extension/src/lib/instance-id.ts:81`；规范化与校验：`apps/extension/src/lib/instance-id.ts:87`。

### 3.2 Extension 内存快照

`ConnectionController` 向 Popup 提供：

```typescript
interface SnapshotInfo {
  state: ConnectionState;
  instanceId: string;
  label: string;
  extensionVersion: string;
  handshake: HandshakeResult | null;
  lastError: string | null;
  connectionEnabled: boolean;
}
```

快照中的标签是扩展后台当前认可的值，而不是输入框中的临时草稿。

### 3.3 Popup 消息

重命名采用请求/响应模式：

```typescript
// Popup -> Background
{ kind: "set_label", requestId: string, value: string }

// Background -> Popup，成功
{ kind: "label_update_result", requestId: string, label: string }

// Background -> Popup，失败
{ kind: "label_update_result", requestId: string, error: string }
```

`requestId` 用于匹配并发请求，避免把旧请求的结果显示为当前保存结果。

### 3.4 WebSocket 握手与 Daemon

扩展在 `system.handshake` 中发送：

```json
{
  "instance_id": "03c3e47f",
  "browser": { "name": "Chrome", "version": "..." },
  "label": "电商-运营-A"
}
```

Daemon 将标签保存在 `BrowserClient.label`，并通过 `system.status` 的 `BrowserStatusEntry.label` 返回给 CLI。

CLI 选择优先级：

1. 精确匹配 `instance_id`。
2. 精确、区分大小写地匹配非空 `label`。
3. 同名标签有多个匹配时返回歧义错误。

协议结构：`crates/bsk-protocol/src/system.rs`；选择逻辑：`crates/bsk-cli/src/daemon/browsers.rs`。

## 4. 实现流程

### 4.1 首次生成

```text
扩展后台启动
  -> 读取/创建 instance_id
  -> 读取 bh_label
  -> 标签为空？
     -> 是：根据浏览器名和 ID 生成默认标签并保存
     -> 否：保留用户标签
  -> 建立 WebSocket
  -> 握手携带 instance_id + label
  -> Daemon 注册浏览器
```

### 4.2 可靠重命名

```text
用户在 Popup 输入新标签
  -> Popup 本地去空格并校验
  -> 生成 requestId，进入“保存中”状态
  -> Background 再次规范化并在存储边界校验
  -> 写入 chrome.storage.local
  -> ConnectionController 刷新标签快照
  -> 断开并重新建立 WebSocket
  -> 新握手把标签同步给 Daemon
  -> Background 返回 label_update_result
  -> Popup 显示“已保存”或具体错误
```

保存按钮和 Enter 键使用同一流程。保存期间按钮禁用，避免连续操作触发多次重连。用户正在编辑时，后台快照不会覆盖输入草稿。

注意：标签是握手字段，因此重命名会产生一次短暂重连。活动任务期间建议避免改名。

## 5. 配置与重命名操作

### 5.1 在扩展 Popup 中配置

1. 打开目标浏览器 Profile。
2. 点击 BrowserSkill 扩展图标。
3. 在“标签”输入框中填写名称。
4. 点击“保存”或按 Enter。
5. 等待“保存中…”变为“已保存”。
6. 连接会短暂重建；随后通过 `bsk browsers` 核对新标签。

有效示例：

```text
电商-运营-A
电商-客服-B
生产-只读
测试-支付回归
Work-Chrome
```

无效示例：

```text
<空字符串>
<只有空格>
<超过 32 字符>
```

### 5.2 CLI 查看和选择

```bash
# 查看在线浏览器及其 instance_id、label、版本和会话数
bsk browsers

# 标签唯一时，可按标签启动会话
bsk session start --browser "电商-运营-A"

# 含空格、中文或 shell 特殊字符时始终加引号
bsk record start --browser "测试 账号 A"

# 自动化和长期脚本建议使用稳定 ID
bsk session start --browser 03c3e47f
```

标签重名时：

```text
1. 运行 bsk browsers 查看候选项。
2. 临时改用完整 instance_id。
3. 在对应 Profile 的 Popup 中将标签改成唯一名称。
```

### 5.3 Agent 操作示例

自然语言任务：

```text
请在“电商-运营-A”浏览器中查看待发货订单，不要操作“生产-只读”。
```

Agent 应先执行：

```bash
bsk browsers
```

确认标签唯一且状态正常后，再按标签或 ID 建立会话。对生产环境、高风险写操作和无人值守任务，应记录并使用完整 `instance_id`，标签只作为人工可读说明。

## 6. 多账户管理方案

### 6.1 推荐模型：一个账户一个浏览器 Profile

```text
浏览器 Profile A
  instance_id: 03c3e47f
  label: 电商-运营-A
  Cookie / Storage: 账号 A

浏览器 Profile B
  instance_id: a7f21b90
  label: 电商-客服-B
  Cookie / Storage: 账号 B
```

优势：

- 登录态由浏览器原生 Profile 隔离。
- 标签让人和 Agent 容易识别用途。
- 实例 ID 可用于稳定、无歧义的自动化。
- 一个账户退出或过期不会影响其他 Profile。

不要依赖同一个 Profile 内频繁退出、登录来切换账户；这会增加任务误投、Cookie 混用和审计困难。

### 6.2 命名规范

推荐结构：

```text
{环境}-{系统或业务}-{角色或账号}
```

示例：

```text
生产-订单-只读
测试-支付-回归
电商-运营-A
电商-客服-B
客户A-工单-处理
```

原则：

- 同一时间在线的标签保持唯一。
- 标签表达用途，不写密码、Token、手机号或完整邮箱等敏感信息。
- 环境前缀固定，例如 `生产-`、`测试-`、`开发-`。
- 高风险实例显式写出 `只读`、`审批` 等用途，但不要把名称当权限控制。

### 6.3 标签、Profile 模板与账户的关系

| 能力 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| 智能标签 | 识别浏览器实例 | 不隔离 Cookie，不授权 |
| 浏览器 Profile | 隔离 Cookie、Storage、扩展数据 | 不提供可读业务名称 |
| Profile 模板 | 按范围应用 Cookie、Storage、UA | 不替代独立 Profile 的安全边界 |
| `instance_id` | 稳定精确选择 | 不适合人工记忆 |

长期、多账户并行操作优先使用独立浏览器 Profile。模板适合测试环境初始化或可控数据迁移，不建议用来替代生产账户隔离。

## 7. 常见问题

### 标签保存失败

- 保留输入内容，根据 Popup 错误提示修正。
- 确认标签非空且不超过 32 字符。
- Popup 连接关闭时重新打开扩展并再次保存。

### 保存后短暂显示未连接

这是正常的标签同步过程：扩展需要重新握手，使 Daemon 收到新标签。

### CLI 提示标签歧义

多个在线实例使用了相同标签。使用 `bsk browsers` 查看完整 ID，然后按 ID 操作或重命名其中一个实例。

### 标签在重启后恢复旧值

检查是否操作了另一个浏览器 Profile。每个 Profile 有独立的扩展存储和实例 ID。

### 卸载扩展后标签消失

标签和实例 ID 存在扩展本地存储中。卸载扩展、清除扩展数据或创建新 Profile 后会生成新的身份和默认标签。

## 8. 关键代码索引

- 默认生成、存储与校验：`apps/extension/src/lib/instance-id.ts`
- 内存状态和重连：`apps/extension/src/lib/connection-controller.ts`
- Popup 消息结构：`apps/extension/src/lib/popup-bridge.ts`
- Popup 请求管理：`apps/extension/src/entrypoints/popup/use-connection-state.ts`
- 配置界面：`apps/extension/src/entrypoints/popup/App.tsx`
- 后台保存与响应：`apps/extension/src/entrypoints/background.ts`
- 握手字段：`apps/extension/src/transport/handshake.ts`
- Rust 协议：`crates/bsk-protocol/src/system.rs`
- Daemon 注册与选择：`crates/bsk-cli/src/daemon/browsers.rs`
