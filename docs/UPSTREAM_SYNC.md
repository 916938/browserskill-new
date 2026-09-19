# 上游同步策略（soft fork）

本文档记录本仓库与上游 `Tencent/BrowserSkill` 的关系定位、量化结论、同步规程和移植清单。

**定位：下游发行版（soft fork）。** 保留上游 remote 并持续吸收其修复，但对外身份、版本线和支持范围由我们自己定义。

---

## 1. 三项既定决策

| # | 决策 | 含义 |
|---|------|------|
| 1 | **协议层必须持续与上游保持兼容** | 不修改握手/协议版本语义。这是低成本同步的前提：一旦协议分叉，cherry-pick 就从"小改"变成"必须重写"。 |
| 2 | **remote / server 模式不纳入移植范围** | 上游 standalone server（公网监听 + 设备配对 + TLS）与我们"只绑 loopback"的不变量冲突。当前基线合并已带入该代码，但**冻结**：不再接受其后续变更。zenx 未来若有远程需求，按自有方式实现，不继承上游该部分设计。 |
| 3 | **保留 Tencent remote，持续吸收修复** | 上游仍在高频修真 bug。仅当出现以下两种情况之一才考虑切断：① 上游在协议层做不兼容变更；② 上游强制默认走 server 模式。 |

---

## 2. 分歧量化（2026-09-19 实测）

| 指标 | 值 |
|------|-----|
| 我方独有提交 | 50（对上游 49） |
| 文件级差异 | 204 文件，+12973 / −13990 |
| **双方都改过的文件**（真实冲突面） | **28** |
| 我方独有代码 | 约 2024 行：`cli/invoke.rs` 671 + `cli/templates.rs` 670 + `daemon/templates.rs` 344 + `protocol/template.rs` 276 + `cli/completion.rs` 63 |
| daemon / protocol 净增 | 1162 行 |
| 版本 | 我方 CLI & 扩展 `0.2.3`；上游 `0.3.0` |
| **协议层** | `crates/bsk-protocol/src/system.rs` 握手逻辑**零分歧**；schema 仅差 `screenshot_full_page`（我方滞后，非有意分歧） |

身份层面其实早已分离：

- `cli/update.rs` 的更新源指向 `916938/browserskill-new/releases`；
- `Cargo.toml` 的 `repository` 为我方；
- 扩展 manifest 含上游没有的 `cookies` 权限；
- `zenxbrowser`、`browserskill-pro` 已依赖 fork-only 的 CLI 面（`--browser-id`、`tab observe`、`browsers close`、`profile_account_id`），在上游构建上跑不起来。

---

## 3. 同步规程

### 3.1 不再整树 merge，改为定向 cherry-pick

整树 merge 的代价是每次人工裁决 28 个重叠文件（含 `App.tsx`、`connection-controller.ts`、`daemon/ws.rs`、`protocol/method.rs`、`skill/SKILL.md`）。改为：

1. `git fetch Tencent`
2. 用 `git log --oneline Tencent/main --since=<上次同步日>` 列出候选
3. 按 §4 清单筛选：只挑 bugfix / 非 remote 的通用改进
4. `git cherry-pick <hash>`（冲突面降到 2–3 个文件）
5. 更新 §5 已移植清单

### 3.2 冲突热点（下次同步优先检查）

```
apps/extension/src/entrypoints/background.ts        # 上游 remote 接线 vs 我方 template client
apps/extension/src/entrypoints/popup/App.tsx        # 上游连接设置 UI vs 我方 useDaemonPort / profile account
apps/extension/src/session-manager/manager.ts
apps/extension/src/tools/dispatcher.ts              # 我方 browser.close / browser-tabs 分支
apps/extension/src/lib/connection-controller.ts     # 我方 profile-account 读取
crates/bsk-cli/src/daemon/ws.rs                     # 我方 template RPC
crates/bsk-protocol/src/method.rs
packages/i18n/src/locales/*/extension.json          # 双方都在加 key
skill/SKILL.md                                      # build.rs 会复制到 crates/bsk-cli/skill/SKILL.md
```

### 3.3 版本号与安装 URL 一律取我方

`Cargo.toml`、`Cargo.lock`、`apps/extension/package.json`、`packages/dsh-plugin-browserskill/package.json` 的版本号冲突一律保留我方（当前 `0.2.3`）；`README.md`、`README.zh-CN.md`、`AGENT_INSTALL.md`、`crates/bsk-cli/README.md` 的安装 URL 一律保留 `916938/browserskill-new`，只吸收上游新增的 PATH 提示等附加说明。

> 版本号升级是独立的发布动作，不在同步提交里顺手改。

### 3.4 验证清单

```bash
cargo check -p bsk --locked
cargo test --workspace --locked --no-fail-fast
pnpm install --frozen-lockfile
pnpm --filter @browser-skill/extension exec wxt prepare
pnpm --filter @browser-skill/extension compile
pnpm ext:test
```

---

## 4. 不移植清单（Not ported）

以下上游内容**明确不跟进**，未来 cherry-pick 时跳过：

| 范围 | 路径 | 理由 |
|------|------|------|
| standalone server | `crates/bsk-cli/src/daemon/remote/**` | 公网监听口，违反 loopback 不变量 |
| 设备配对 / 凭据 | `apps/extension/src/transport/remote-authorization.ts`、`remote-storage.ts`、`remote-endpoint.ts` | 同上，属远程信任面 |
| 远程连接文档 | `docs/remote-extension-connection.md` | 不对外承诺该能力 |
| 远程模式测试 | `crates/bsk-cli/tests/remote_server.rs` | 见 §6 已知失败 |

现有树中的这部分代码是**基线合并的副产品，不是我们的支持范围**：不写进我方文档、不作为默认路径、不承诺行为。

---

## 5. 已移植清单（Ported）

### 5.1 2026-09-19 基线合并（`7edb391`）

一次性合入上游 49 个提交（我方 50 个），19 个文件冲突 / 30 个冲突块。主要吸收：

| 类别 | 代表提交 |
|------|---------|
| 后台标签执行与截图 | `f85876a` `6347ccf` `84f7bf7` `fb2d161` `c772fa0` `a7540c3` |
| 导航就绪与取消重定向 | `237667b` `c26560a` `d3f9e91` |
| VOM 兄弟上下文缓存（性能） | `f1e8374` |
| 输入就绪与原生输入结果 | `1edee0f` `1740a1d` `c8bfb98` `3519874` |
| 全页截图修复 | `ee5afd3` `3af3fe3` `37393f3` |
| dsh 插件输出排空 | `d947823` |
| 远程连接（冻结，见 §4） | `f925bde` `18aa202` `2647f72` |

合并保留的我方能力：`bsk invoke`、`templates`、`completion`、`browser.close`、`browser-tabs`、`profile account id`、`since` 游标、smart labels。

### 5.2 后续 cherry-pick

| 提交 | 日期 | 内容 |
|------|------|------|
| _(待续)_ | | |

---

## 6. 已知失败

- `cargo test -p bsk --test remote_server`：Windows 上 1–2 例不稳定失败（`authorization_file_contention_does_not_block_socket_messages` 断言 401 vs 503；`sixty_four_online_browsers_leave_http_exchange_capacity_available` 报 `Access is denied (os error 5)`）。该测试文件与 `daemon/remote/**` 均相对上游零改动，属 Windows 文件争用语义差异；按 §4 该项不在我们的支持范围，不修。
- 其余目标全绿（2026-09-19：`cargo test --workspace --no-fail-fast` 仅此 1 个 target 失败；`pnpm ext:test` 2062 passed / 103 skipped / 0 failed，127 files）。

---

## 7. 待办（soft fork 身份步骤，未包含在本轮同步）

1. 版本线独立：与上游 `0.3.0` 显式区分（当前仍保持 `0.2.3`）。
2. 对外品牌去 "BrowserSkill"（上游商标）。CLI 二进制名 `bsk` **保留**——`zenxbrowser` 与 `browserskill-pro` 全部脚本硬编码依赖，改名收益不抵成本；且我们不 `cargo publish`，不存在 crate 名冲突。
3. `LICENSE`：保留 Tencent 的 MIT 版权行，另起一行加我方 copyright 与 modified 说明（MIT 硬性要求）。
4. `browserskill-pro` / `zenxbrowser` 文档写明"依赖 fork 构建，非上游 BrowserSkill"，列出 fork-only 命令。
5. `AGENTS.md` 不变量 #2 需改写为"默认且受支持的模式是 loopback；上游 remote/server 模式虽在树中但不受支持"。
