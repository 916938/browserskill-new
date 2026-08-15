# Merge Commit Review 与 Release Notes 审查

## 1. 审查范围

审查对象：

```text
commit:  cfbc286ea4876e7082279f9a957e3b02ad59d7e2
subject: Merge remote-tracking branch 'Tencent/main' into chain
```

父提交：

```text
chain:        23568ff7acb987f878511b2d786355f8a84985b5
Tencent/main: 4549ed08923b3b540a2d26b429ce1fd841abe1f
```

审查范围包括：

- merge commit 的冲突解决
- CLI、协议、扩展和 VOM 集成
- 版本号与锁文件一致性
- 测试覆盖和验证结果
- CHANGELOG 和 release notes 完整性
- 当前分支和远程推送状态

## 2. 结论

总体结论：**没有发现阻断级或高危问题，合并质量良好，可以继续进行发布准备。**

审查时发现发布文档没有跟上当前版本；该文档缺口已在本次任务中补齐，但正式版本和新标签仍待确定：

- `Cargo.toml` 当前版本为 `0.2.1`
- `apps/extension/package.json` 当前版本为 `0.1.6`
- `CHANGELOG.md` 最新正式条目仍为 CLI `v0.2.0` / Extension `v0.1.4`
- 已新增 post-merge `CHANGELOG [Unreleased]` 和 `RELEASE_NOTES_CHAIN_MERGE.md`
- 现有 `cli-v0.2.1` / `ext-v0.1.6` 标签早于本次 merge，不包含完整变更

正式发布前仍需确定新版本号并创建包含 merge commit 的新标签。

## 3. Findings

### M-1：版本号与 CHANGELOG 不一致

**严重级别：Medium**

**位置：**

- `Cargo.toml:10`：`version = "0.2.1"`
- `apps/extension/package.json:3`：`"version": "0.1.6"`
- `CHANGELOG.md:8`：审查时 `[Unreleased]` 为空；现已补充 post-merge 内容

**问题：**

代码版本已经进入 CLI `0.2.1` 和 Extension `0.1.6`，但 CHANGELOG 没有对应记录。合并引入了大量新能力，包括 VOM、emulate、observe、window management、cooperative cancellation 和更新链路，现有发布文档不能反映当前代码状态。

**影响：**

- 发布人员难以确认当前版本包含哪些功能。
- 发布自动化或版本校验可能发现版本与文档不一致。
- 用户无法通过 CHANGELOG 判断升级内容和兼容性。

**建议：**

补充 `[Unreleased]` 内容，并在确认发布版本后创建新的正式版本条目和标签。由于现有 `cli-v0.2.1` / `ext-v0.1.6` 标签早于本次合并，不应复用这些标签表示 merge change set。

**状态：** 已更新 `CHANGELOG.md` 的 `[Unreleased]`，并新增 `RELEASE_NOTES_CHAIN_MERGE.md`。正式版本和新标签仍待确定。

### L-1：生产代码存在待办注释

**严重级别：Low / Informational**

**位置：**

- `crates/bsk-cli/src/daemon/ws.rs:43`

```rust
/// TODO(M10/M12): pair v0.1 GA with an actual extension-id allow-list
```

**问题：**

代码中保留了关于 extension-id allow-list 的待办事项。

**影响：**

当前不构成已确认的功能回归，但说明 WebSocket 接入控制仍有后续安全加固计划。

**建议：**

在正式 GA 或安全审查阶段单独跟进该 TODO，确认是否需要实际的 extension-id allow-list、配置来源和升级兼容策略。

### L-2：审查时合并提交没有单独的发布说明

**严重级别：Low**

**位置：**

- `RELEASE_NOTES_v0.2.0.md`
- 审查时缺少本次 merge 的独立 release note；现已新增 `RELEASE_NOTES_CHAIN_MERGE.md`

**问题：**

已有 `RELEASE_NOTES_v0.2.0.md` 只覆盖此前 Profile Template System 发布内容，没有覆盖本次上游合并的大量新增功能。

**建议：**

已新增 `RELEASE_NOTES_CHAIN_MERGE.md`，覆盖：

- VOM
- hover 和 recording
- emulate
- Agent Window
- cancellation / reconnect
- screenshot fallback
- Windows update/install
- protocol schema
- 测试和兼容性说明

正式发布前仍需将该未发布说明绑定到一个包含 merge commit 的新版本标签。

## 4. 已确认的正确点

### 4.1 冲突解决完整

已确认以下冲突处理保留了双方有价值的功能：

| 文件 | 审查结论 |
|------|----------|
| `Cargo.toml` | 保留 `chain` 的 `0.2.1` 版本 |
| `Cargo.lock` | 与 Cargo.toml 一致，构建通过 |
| `crates/bsk-cli/src/cli/mod.rs` | invoke、templates、hover、window、emulate 等命令均保留 |
| `crates/bsk-cli/src/main.rs` | 对应 dispatch 分支均存在 |
| `crates/bsk-protocol/src/method.rs` | `MethodEffect` 分类统一 |
| `crates/bsk-cli/src/skill_install/harness.rs` | Hermes 与 KimiCode 测试均保留 |
| `apps/extension/src/entrypoints/background.ts` | template、heartbeat、disconnect cleanup 均保留 |
| `apps/extension/src/entrypoints/popup/App.tsx` | label、TemplateView、Switch、control hints 均保留 |
| `apps/extension/src/entrypoints/popup/App.test.tsx` | label 和 control hints 测试均保留 |
| `apps/extension/src/lib/connection-controller.ts` | label 更新与可取消握手逻辑均保留 |
| `skill/SKILL.md` | hover 说明和 quick decision tree 均保留 |

### 4.2 VOM 工作区包集成正确

新增：

```text
packages/vom/
```

并已通过：

- pnpm workspace 自动发现
- `apps/extension/package.json` 的 `workspace:*` 依赖
- frozen lockfile 安装
- TypeScript 编译
- 扩展测试

### 4.3 测试覆盖充足

新增或大幅扩展了：

- Rust CLI 和 daemon 测试
- 录制测试
- VOM capture 和 render 测试
- observation 测试
- emulate 测试
- window 测试
- heartbeat 和 disconnect cleanup 测试
- hover policy 测试
- capture suppression 测试

### 4.4 国际化覆盖完整

已核对：

```text
packages/i18n/src/locales/en-US/extension.json
packages/i18n/src/locales/zh-CN/extension.json
```

Popup label、templates、record、control hints 等新增 UI 文案均有对应 locale key。

## 5. 验证结果

### Rust

```text
cargo build -p bsk                         passed
cargo clippy --workspace --all-targets ... passed
cargo test --workspace --locked            121 passed, 0 failed
cargo fmt --all -- --check                 passed
```

### Extension

```text
wxt prepare                                  passed
pnpm --filter @browser-skill/extension compile passed
pnpm ext:test                                55 files passed
                                               788 tests passed
```

### Node

```text
node --test scripts/*.test.mjs               1 passed, 0 failed
```

### Merge integrity

仓库中没有发现残留冲突标记：

```text
<<<<<<<
=======
>>>>>>>
```

## 6. 远程状态

远程仓库：

```text
916938/browserskill-new
```

远程分支：

```text
916938/chain
```

远程提交：

```text
cfbc286ea4876e7082279f9a957e3b02ad59d7e2
```

本地和远程没有差异：

```text
ahead: 0
behind: 0
```

## 7. 发布建议

按优先级排列：

1. 已补充 `CHANGELOG.md` 的 `[Unreleased]` 和 `RELEASE_NOTES_CHAIN_MERGE.md`。
2. 正式发布前确定新的 CLI / Extension 版本，并创建包含 merge commit 的新标签；不要复用既有标签。
3. 在发布前检查 Cargo、Extension package、Git tag 和 release notes 的版本一致性。
4. 在正式发布流程中跟进 `crates/bsk-cli/src/daemon/ws.rs:43` 的 extension-id allow-list TODO。
5. 在 release branch 或 CI 环境再次运行完整 Rust 和 Extension 测试。

## 8. 审查摘要

```text
Critical: 0
High:     0
Medium:   1
Low:      2
```

审查发现的 CHANGELOG/release notes 内容缺口已补齐为未发布说明。正式发布前仍需确定新版本和新标签。代码合并本身通过构建、类型检查、lint 和测试验证，未发现阻断发布的功能回归。
