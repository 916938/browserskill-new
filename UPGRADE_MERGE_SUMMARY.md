# BrowserSkill 升级与合并说明

## 1. 概述

本次工作将本地 `chain` 分支与 Tencent 上游 `Tencent/main` 分支合并，目标是同步上游近期功能和修复，同时保留 `chain` 分支已有的 CLI、Profile Templates、实例标签和 `bsk invoke` 等定制能力。

合并采用 merge commit，未使用 rebase，因此双方原有提交历史均被保留。

## 2. 合并提交

```text
commit:  cfbc286ea4876e7082279f9a957e3b02ad59d7e2
subject: Merge remote-tracking branch 'Tencent/main' into chain
date:    2026-08-15 11:48:01 +08:00
```

父提交：

```text
chain:        23568ff7acb987f878511b2d786355f8a84985b5
Tencent/main: 4549ed08923b3b540a2d26b429ce1fd841abe1f
```

合并前双方分支存在明显分歧：

- `chain` 独有提交：31 个
- `Tencent/main` 独有提交：73 个
- 共同祖先：`ff74db48c89a4b480c320a90294295bfa271b7a0`

## 3. 变更规模

从合并前的 `chain` 提交到合并提交，共涉及：

```text
161 files changed
22,707 insertions(+)
1,385 deletions(-)
```

主要影响范围：

- 浏览器扩展
- VOM 语义观察
- 录制和悬停交互
- CLI 命令
- bsk 协议和 JSON Schema
- Agent Window
- 移动设备模拟
- WebSocket 和会话生命周期
- Windows 兼容性
- 自动更新和安装
- 扩展发布工作流
- 测试套件

## 4. 主要升级内容

### 4.1 VOM 语义观察

新增 `@browser-skill/vom` 工作区包，提供 Visual Object Model 的类型、层级处理和渲染能力：

```text
packages/vom/
apps/extension/src/tools/vom/capture.ts
apps/extension/src/tools/observation.ts
```

扩展端新增 VOM capture、观察结果转换和大量相关测试，增强了页面结构、元素引用和条件交互面的语义表达能力。

### 4.2 Hover 和录制能力

本次合并增强了：

- hover candidate pool
- hover trigger policy
- hover surface 识别
- 录制过程中的悬停
- VOM 中的“需要先 hover”提示
- 录制覆盖层和录制计时器
- 页面导航后的录制状态保持
- 截图时隐藏扩展覆盖层

主要区域：

```text
apps/extension/src/content/record-capture.ts
apps/extension/src/content/record-hover-surface.ts
apps/extension/src/lib/hover-trigger-policy.ts
apps/extension/src/content/overlay-controller.ts
```

### 4.3 移动设备模拟

新增移动设备模拟能力，包含 viewport、User-Agent、touch 模式和设备元数据：

```text
crates/bsk-cli/src/cli/emulate.rs
apps/extension/src/tools/emulate.ts
crates/bsk-protocol/src/tools/emulate.rs
crates/bsk-protocol/schema/tool_emulate_*.json
```

### 4.4 Agent Window 管理

新增和增强 Agent Window 管理能力：

- Window 管理命令
- Window resize
- 启动时指定窗口尺寸
- `--no-focus` 非聚焦启动
- Window 相关协议和扩展工具

主要文件：

```text
crates/bsk-cli/src/cli/window.rs
apps/extension/src/tools/window.ts
crates/bsk-protocol/src/tools/window.rs
apps/extension/src/session-manager/agent-window.ts
```

### 4.5 取消、重连和会话清理

上游带来了更完整的工具取消和连接生命周期处理：

- cooperative cancellation
- handshake generation 和 `AbortSignal`
- 失败握手后的半连接清理
- WebSocket 重连生命周期加固
- disconnect 后的 session cleanup
- 用户中断到工具执行链的更可靠传递

主要区域：

```text
apps/extension/src/lib/connection-controller.ts
apps/extension/src/session-manager/disconnect-cleanup.ts
apps/extension/src/transport/ws-transport.ts
crates/bsk-cli/src/daemon/session_interrupt.rs
```

### 4.6 截图和覆盖层

截图流程增加了：

- `captureVisibleTab` 失败时回退到 CDP capture
- capture 期间抑制扩展覆盖层
- 避免录制提示和控制提示出现在页面截图中

主要文件：

```text
apps/extension/src/browser-driver/chromium-cdp.ts
apps/extension/src/content/capture-suppress.ts
apps/extension/src/lib/capture-suppress-bridge.ts
```

### 4.7 更新、安装和 Windows 兼容性

同步了以下能力和修复：

- daemon 周期性更新检查
- daemon 发现新版本后自动升级 bsk
- staged Windows replacement
- release archive checksum 校验
- hash-only Windows named pipe 名称
- Windows 下的进程和 daemon 生命周期修复
- 安装脚本和扩展发布工作流更新

主要文件：

```text
crates/bsk-cli/src/cli/update.rs
crates/bsk-cli/src/daemon/start.rs
crates/bsk-cli/src/daemon/paths.rs
install.ps1
install.sh
.github/workflows/release-extension.yml
```

### 4.8 协议和 Schema

新增或更新了以下协议能力：

- hover
- observe
- emulate
- window resize
- record await / stop
- request help
- session start
- trace 和 trace step

同时更新了 `crates/bsk-protocol/schema/` 下对应 JSON Schema。

`MethodEffect` 分类最终统一为：

```text
ControlPlane
PassiveRead
TransientInput
BrowserMutation
```

其中：

```text
TemplateList/Get/Create/Update/Delete -> ControlPlane
TemplateApply                         -> BrowserMutation
Cancel                                -> ControlPlane
```

## 5. chain 分支功能保留

本次合并保留了 `chain` 的以下本地能力：

### 5.1 `bsk invoke`

保留原始 JSON RPC passthrough、dry-run、环境变量默认值、人类可读 timeout 和 shell completion 支持。

### 5.2 Profile Templates

保留模板 CRUD、模板应用、scope 选择和 Popup UI，并将模板方法正确纳入 `MethodEffect` 分类。

### 5.3 浏览器 label 和实例 ID

保留实例 label 编辑、智能默认 label、实例 ID 展示与复制，并兼容上游新增的控制提示存储键：

```text
bsk_control_hints_hidden
```

### 5.4 使用文档

保留并合并：

- Quick decision tree
- VOM hover 使用说明
- console 和 network 命令说明
- snapshot 重新获取规则

同步文件：

```text
skill/SKILL.md
crates/bsk-cli/skill/SKILL.md
```

## 6. 冲突处理

本次主要冲突及处理方式如下：

- `Cargo.toml` / `Cargo.lock`：保留 `chain` 的 CLI 和协议版本 `0.2.1`。
- `cli/mod.rs` / `main.rs`：合并 `InvokeArgs`、`TemplatesCmd`、`HoverArgs`、`WindowCmd` 和 `EmulateArgs`。
- `method.rs`：统一采用 `MethodEffect` 返回值，同时保留模板操作分类。
- `harness.rs`：保留 Windows Hermes 测试和 Tencent 的 KimiCode 支持及测试。
- `connection-controller.ts`：保留 label 更新断开方法，并采用带 generation / signal 的可取消握手实现。
- `App.tsx` / `App.test.tsx`：保留 label 编辑、TemplateView、Switch 和 control hints toggle。
- `SKILL.md`：保留 hover 说明和 quick decision tree。
- `pnpm-lock.yaml`：合并后发现缺少 vitest 依赖条目，重新生成并通过 frozen install 验证。

## 7. 验证结果

### Rust

```text
cargo build -p bsk                         passed
cargo clippy --workspace --all-targets ... passed
cargo test --workspace --locked            121 passed, 0 failed
cargo fmt --all -- --check                 passed
```

### Extension

```text
wxt prepare                              passed
pnpm --filter @browser-skill/extension compile  passed
pnpm ext:test                            55 files passed
                                           788 tests passed
```

### Node 脚本

```text
node --test scripts/*.test.mjs             1 passed, 0 failed
```

### 合并检查

仓库中无残留冲突标记：

```text
<<<<<<<
=======
>>>>>>>
```

## 8. 推送状态

远程仓库：

```text
916938/browserskill-new
```

远程分支：

```text
916938/chain
```

远程当前提交：

```text
cfbc286ea4876e7082279f9a957e3b02ad59d7e2
```

本地和远程一致：

```text
ahead: 0
behind: 0
```

当前工作树干净。

## 9. 发布文档状态

当前仓库的 `Cargo.toml` 版本为 `0.2.1`，扩展版本为 `0.1.6`。现有 `cli-v0.2.1` 和 `ext-v0.1.6` 标签早于本次 merge commit，因此不能代表完整的合并内容。

本次已完成以下发布文档补充：

- 更新 `CHANGELOG.md` 的 `[Unreleased]`。
- 新增 `RELEASE_NOTES_CHAIN_MERGE.md`，记录合并后的未发布内容。
- 明确现有版本标签不包含完整 merge change set，后续发布不应复用旧标签。

正式发布前仍需确定新的 CLI 和 Extension 版本并创建包含 `cfbc286` 的新标签。

## 10. 总结

本次合并完成了 Tencent 上游 73 个提交与 `chain` 31 个提交的整合，保留了双方历史和主要功能。升级后系统具备更完整的 VOM 观察、hover、录制、移动设备模拟、Agent Window、取消重连、Windows 更新和协议 Schema 能力，同时保留了 Profile Templates、`bsk invoke` 和实例标签等本地功能。

Rust、TypeScript、扩展测试、格式检查和 Node 测试均已通过，`chain` 分支已推送并与远程同步。
