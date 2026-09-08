# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Upstream sync — 2026-09-08（Tencent/BrowserSkill `47ac947` → `3c5f838`，205 commits）

合并上游 PR #179、#186、#187、#188、#189、#190、#191、#192。

#### Added

- Windows 自更新：detached helper 带重试上限、就绪确认与日志（`crates/bsk-cli/src/cli/update/windows.rs`）。
- `fill` 成功前校验：新增 `fill_target_changed` / `fill_value_mismatch` / `target_not_fillable` 错误分类。
- CDP 跨扩展帧访问拒绝（`cdp_extension_access_denied`）的识别与面向 Agent 的提示。
- 会话停止时释放自动化状态（`releaseSessionTab`）与归还 tab 后的状态清理。

#### Fixed

- 已关闭的借用 tab 不再阻塞 `bsk session stop`（#186）。
- 归还 tab 时正确释放 automation state（#187）。
- 表单状态按元素匹配，避免跨元素误判（#188）。
- DSH 插件 observation 同步与截图 capture 一致性（#190）。
- Windows IPC 进程存活判定（#191）。

#### Fork 取舍

- `packages/dsh-plugin-browserskill/**`：整体采用上游，重放 fork 的 CRLF frontmatter 修复。
- 保留 fork 特性：smart label 编辑、Profile Templates、`bsk invoke` 与 shell completion、Windows 非 Unix 适配。
- `skill/SKILL.md`、README、CHANGELOG 保留 fork 增强版，未采纳上游对 SKILL.md 的精简重写。
- i18n：保留 fork 的 Profile Template 文案，采纳上游文案更新。

#### Verification

- `cargo check --workspace --all-targets` 通过；`cargo test` 单测 325 通过。
- 扩展 `tsc --noEmit` 通过；`vitest` 1128 通过。
- 已知失败：`record_export_recovery::failed_bundle_export_can_be_recovered` 在非管理员 Windows 上创建命名管道 `\\.\pipe\daemon` 被拒（Access denied），属环境限制，与本次合并无关。

## [0.2.2] - 2026-09-06

从 2026-09-06 起，CLI / Extension / DSH Plugin 共用同一 semver（沿用上游 0.2.0 起的版本方案）。

### Changed

- 合并上游 `Tencent/main`（`47ac947`）的 182 个提交：文件上传下载、VOM 语义图与 hover 感知、DSH Harness 插件、`evals/browser` 测试台、统一发布脚本等。
- 三组件版本号统一为 `0.2.2`（此前 CLI `0.2.1`、Extension / DSH Plugin `0.2.0`）。
- 冲突取舍保留 fork 特性：fork 安装 URL、`skill/SKILL.md` 的多浏览器与智能标签指引、`bsk invoke` 的 `clap_complete` 补全、Profile 模板（`TemplateRegistry`）；上游新增能力与其并存。

### Fixed

- `daemon/file_transfer.rs`：`set_private_dir` / `set_private_file` 在非 Unix 平台参数未使用，导致 `clippy -D warnings` 编译失败（上游同样存在）。

## [上游合并前的 Unreleased 记录]

### Added

- Added the `@browser-skill/vom` workspace package and semantic VOM capture/rendering pipeline.
- Added `bsk observe`, hover-aware interactions, hover-surface recording, and related protocol schemas.
- Added mobile device emulation for viewport, User-Agent, touch, and user-agent metadata.
- Added Agent Window management, window resizing, and `--no-focus` session startup.
- Added popup control-hint visibility settings with persistent extension storage.
- Added Kimi Code skill-install harness support.

### Changed

- Merged Tencent upstream `main` into `chain` while retaining Profile Templates, browser labels, and `bsk invoke` enhancements.
- Reworked method classification around `ControlPlane`, `PassiveRead`, `TransientInput`, and `BrowserMutation` effects.
- Hardened WebSocket handshake, reconnect, heartbeat, cancellation, and session-cleanup lifecycles.
- Expanded recording overlays, hover capture, VOM observation, and human-loop behavior.
- Extended CLI, extension, protocol, and generated JSON Schema coverage for the new tools.

### Fixed

- Added CDP screenshot fallback when `captureVisibleTab` fails and suppresses extension overlays during capture.
- Fixed Windows named-pipe naming and staged executable replacement during updates.
- Added release archive checksum verification and periodic daemon update checks.
- Regenerated the pnpm lockfile after the upstream merge to restore the `@browser-skill/vom` workspace dependency graph.

### Verification

- Rust: 121 tests passed; Clippy and `cargo fmt --check` passed.
- Extension: TypeScript compilation passed; 788 tests across 55 files passed.
- Node scripts: 1 test passed.

> This section describes the post-merge `chain` branch at commit `cfbc286`. Existing tags `cli-v0.2.1` and `ext-v0.1.6` predate this merge and do not contain the complete change set above.

---

## Upstream 0.2.0 — 2026-09-02（合并自 Tencent/BrowserSkill）

### Added
- File transfer: upload and download support across CLI, Extension, and DSH Plugin
- File transfer: drag-and-drop upload (`drop-to-upload`)
- VOM semantic graph, name enrichment, and hover perception modules
- VOM hover probing (opt-in via `observe` parameter)
- DSH Plugin: browser tool parity with CLI commands
- Edge Add-ons automated publishing in CI
- Protocol upgrade reminder when CLI / Extension protocol versions differ
- Browser evaluation harness (`evals/browser/`)
- Unified release script (`scripts/release.mjs`)

### Changed
- **Version scheme**: all three components now share the same semver
- VOM rendering algorithm optimizations
- Leaner SKILL.md agent instructions
- DSH Plugin: simplified browser commands
- Borrow confirmation UX — proactive focus and longer timeout
- PiP window now has a close button

### Fixed
- Screenshot media type detection (was hard-coded to `image/png`)
- DSH Plugin session lifecycle stability
- DSH Plugin Cordis package ID mismatch
- Observation thumbnail media type sniffing
- Upload/download race conditions and layout bypass issues
- VOM repeated name and safety policy issues

---

*Previous releases used independent version numbers per component.*

## CLI 0.1.11 / Extension 0.1.7 / DSH Plugin 0.1.2 — 2026-08-26 ~ 2026-08-29

### Added
- DSH Plugin sidebar integration, session lifecycle, and archive cleanup
- Recorder iframe and OOPIF support

### Changed
- VOM functional refactor

### Fixed
- Recorder safety policy and bug fixes

## CLI 0.1.10 / Extension 0.1.6 — 2026-08-08

### Added
- VOM observation recording and settled-state detection
- Record overlay timer

### Fixed
- Browser keepalive disconnect handling

## CLI 0.1.9 / Extension 0.1.5 — 2026-07-29

### Added
- CLI auto-update mechanism
- Trace v3 protocol and recorder

### Fixed
- MV3 keepalive disconnect

## CLI 0.1.8 / Extension 0.1.4 — 2026-07-22

### Added
- More browser interaction actions

### Fixed
- Windows named-pipe hash-only path issue

## CLI 0.1.7 / Extension 0.1.3 — 2026-07-07

Initial public release pair.

## CLI 0.1.6 — 2026-06-30

### Fixed
- Minor CLI fixes

## CLI 0.1.5 / Extension 0.1.2 — 2026-06-22

First tagged releases.

## [CLI v0.2.0] & [Extension v0.1.4] - 2026-07-24

### Added

#### Major Features

- **Profile Template System** (PR #4)
  - Complete CRUD operations for browser profile templates via CLI, Daemon RPC, and Popup UI
  - Save and restore: cookies, `chrome.storage.local` data, User-Agent strings
  - Template persistence as JSON files in `~/.bsk/templates/{uuid}.json`
  - **27 files changed, +4,020 lines**

##### CLI Commands (`bsk templates`)

| Command | Description |
|---------|-------------|
| `bsk templates list` | List all templates (summaries) |
| `bsk templates get <id>` | Show full template details |
| `bsk templates create --name <name> [--description] [--user-agent]` | Create new template |
| `bsk templates update <id> [--name] [--description] [--user-agent]` | Update template |
| `bsk templates delete <id>` | Delete template by ID |
| `bsk templates apply <id> --scope all\|cookies\|storage\|user-agent` | Apply template to current profile |

##### Protocol API (WS/IPC)

New RPC methods: `template.list`, `template.get`, `template.create`, `template.update`, `template.delete`, `template.apply`

##### Extension Changes

- `template-client.ts`: Type-safe RPC client for template operations
- `apply-template.ts`: Apply cookies via `chrome.cookies.set()`, storage via `chrome.storage.local.set()`
- **Popup UI**: New Templates tab with list/create/edit/delete/apply + scope selector + toast notifications
- Manifest: Added `cookies` permission for template apply functionality
- i18n support: zh-CN + en-US keys for template UI

### Fixed

- **Clippy `--all-targets` warnings** resolved across all test targets
- **TypeScript strict typing**: i18n key inference narrowed to literal unions
- **ResponseFrame protocol alignment**: Fixed `.body` wrapper in template-client to match actual `{id, result/error}` shape
- **Platform-specific import**: Added `#[cfg(unix)]` guard for `wait_for_abort_registered` in integration tests

### Test Coverage

| Component | New Tests | Total Tests |
|-----------|-----------|-------------|
| Rust (template) | 20 new unit/integration tests | 253+ total |
| TypeScript (template) | 44 new tests | 520+ total |

### Migration Guide

**No breaking changes** - Fully backward compatible.

All existing commands work as before. The `templates` subcommand and template protocol methods are purely additive.

### Contributors

- @paddlelaw - Feature implementation (PR #4)

---

## [CLI v0.1.8] & [Extension v0.1.4] - 2026-07-22

### Added

#### Major Features

- **`bsk record` - Semantic User Action Recording** (PR #28)
  - Capture user actions in Agent Window and export record-only traces
  - Supports: navigate, click, fill, select, press steps with target descriptors
  - Record Overlay UI aligned with Control Overlay
  - CLI commands: `bsk record start`, `bsk record stop`, `bsk record await`
  - Popup quick-actions launcher for easy access
  - Optional `--url` parameter (defaults to `example.com`)
  - Full protocol support: CLI → daemon → protocol → extension pipeline
  - **47 files changed, +6,038 lines** (largest feature addition to date)

- **`bsk network` - Network Request Read-only Command** (PR #8)
  - Read buffered network responses/failures for a tab
  - Mirrors `bsk console` command conventions exactly
  - Options: `--session`, `--tab-id`, `--since`, `--limit`, `max-text-chars`
  - Cursor-paginated reads (`since` → `next_since`) for agent-context safety
  - Real HTTP status codes (response) or CDP failure reasons (failure)
  - Extension enables `Network.onAttach` (best-effort)
  - **19 files changed, +1,156 lines**

- **Enhanced `bsk invoke` JSON RPC Passthrough**
  - Raw JSON params forwarding via `--args-json <json>` or `--args-file <path>`
  - Resolves action names: bare (`fill`), underscored (`session_stop`), fully qualified (`tool.fill`)
  - Rejects interactive stdin before blocking on read
  - Merges `--session` into params; errors on session_id conflict

### Fixed

#### Extension Improvements

- **Borrow timeout overlay dismissal** (PR #16)
  - Send borrow-cancel on confirmation timeout deny
  - Timer fallback so auto-deny doesn't depend only on CSS transitionend
  - Improved test coverage for edge cases

- **Session idle timeout enforcement** (PR #22)
  - Daemon now properly enforces session idle timeouts
  - Fixed probe race conditions in idle daemon helper tests
  - More reliable session cleanup

- **Doctor command exit code** (PR #23)
  - `bsk doctor` now exits nonzero on failed checks
  - CI improvements: retry logic for stalled Rust jobs
  - Better error reporting for CI failures

- **Error message accuracy** (PR #29)
  - Corrected incorrect command examples in error messages
  - Improved user guidance when commands fail

- **Record prompt copy fix**
  - Fixed copy functionality in recording prompt overlay

### Changed

- **Version bumped**: CLI `0.2.0` → `0.1.8`, Extension remains at `0.1.4`
- **Tencent/main merge**: Integrated upstream changes from Tencent main branch
- **Coverage report**: Added `coverage_report/` to `.gitignore`

### Documentation

- Updated SKILL.md with:
  - Quick decision tree for tab/browser/observation choices
  - Clarified bsk fill as plain-text replacement (no rich-text semantics)
  - BrowserSkill Pro feature comparison table
  - Record command usage examples

### Test Coverage

| Component | New Tests | Total Tests |
|-----------|-----------|-------------|
| Record feature | ~12 new test files | 163+ record-specific tests |
| Network command | 125+ new tests | Full IPC integration suite |
| Overlay/Controller | 49+ updated tests | Enhanced edge case coverage |
| Overall | ~500+ new tests | Estimated 700+ total |

### Migration Guide

**No breaking changes** - Fully backward compatible with v0.2.0.

All existing commands work as before. New commands (`record`, `network`) are additive.

### Contributors

- @haonan (Record feature - major contribution)
- @hjxccc (Network command)
- @polarday (PR #28 merge)
- @BB-fat (PR #8, #16, #22, #23, #29 merges)
- @NianJiuZst (Session timeout, doctor fixes)
- @klren0312 (Error message fixes)
- @paddlelaw (Invoke enhancement, documentation)

---

## [CLI v0.2.0] & [Extension v0.1.4] - 2026-07-17

### CLI Added

- **Dry-run mode for `bsk invoke`** - Preview RPC calls without executing them using `--dry-run` flag
  - Shows action name, method, session ID, parameters, and timeout in JSON or human-readable format
  - Useful for debugging and validating commands before execution

- **Environment variable defaults** for `bsk invoke`
  - `BSK_DEFAULT_SESSION`: Set default session ID without passing `--session` every time
  - `BSK_INVOKE_TIMEOUT_MS`: Override default timeout via environment variable
  - Empty/whitespace values are safely ignored

- **Human-readable timeout formats** for all timeout arguments
  - Accepts: `30s`, `1m`, `250ms`, or bare milliseconds (`30000`)
  - Backward compatible: `--timeout-ms` alias preserved
  - Reuses existing `parse_timeout_ms()` from navigate module for consistency

- **Shell completion support** (`bsk completion` subcommand)
  - Generates completion scripts for: Bash, Zsh, Fish, PowerShell
  - Includes all commands, flags, subcommands, and options
  - Install instructions added to SKILL.md documentation

### Changed

- **Version bumped**: CLI `0.1.7` → `0.2.0`, Extension `0.1.3` → `0.1.4`

### Fixed

#### Rust (CLI)
- **Missing import** - Added `wait_for_abort_registered` import to `tools_m9_ipc.rs` integration test
- **Unfulfilled lint expectation** - Removed `#[expect(dead_code)]` from `handle_cancel_with_registry_only()` (function is used in tests)

#### Frontend (Extension)
- **Line ending normalization** - Converted 112 files from CRLF to LF for cross-platform CI compatibility
- **Biome formatter violations** fixed in 4 files:
  - `keepalive.test.ts` - Proper line wrapping for long assignments
  - `ws-transport.test.ts` - Correct function call formatting
  - `ws-transport.ts` - Compact import statement
  - `vitest.config.ts` - Single-line JSON.stringify call
- **Async test assertions** in ws-transport tests:
  - Changed synchronous `.toThrow()` to async `await expect().rejects.toThrow()` for Promise-based errors
  - Improved timeout test reliability using `vi.useFakeTimers()` to avoid real timer delays

### Security

- No security vulnerabilities addressed in this release

### Documentation

- Updated `skill/SKILL.md` with comprehensive `bsk invoke` flag reference table
- Added dry-run output examples and format descriptions
- Documented environment variable usage (`BSK_DEFAULT_SESSION`, `BSK_INVOKE_TIMEOUT_MS`)
- Included shell completion installation commands for Bash, Zsh, Fish, and PowerShell

### Test Coverage

| Component | Line Coverage | Function Coverage | Test Count |
|-----------|--------------|-------------------|------------|
| `invoke.rs` | 73.42% | 68.85% | 28 new tests |
| Overall (CLI) | 47.95% | 50.09% | 193 total tests |
| Extension | N/A | N/A | 378 tests |

### CI/CD Improvements

- All 3 GitHub Actions checks now pass consistently:
  - ✅ Rust fmt, clippy, tests
  - ✅ Frontend lint, typecheck, tests, build
  - ✅ Node script tests
- Eliminated flaky test failures caused by environment-specific issues

### Migration Guide

**No breaking changes** - Fully backward compatible with v0.1.7.

All existing commands and flags work exactly as before.

### Contributors

- @paddlelaw (Code + Documentation)

---

## [CLI v0.1.7] - Previous Release

### Added
- Windows platform compatibility fixes
- Generic passthrough command: `bsk invoke` for any `tool.*` RPC via raw JSON arguments
- Transport layer improvements: `sendAndWait` for request-response correlation
- Keepalive system: MV3 service-worker ping mechanism
- Multi-browser support documentation
- AGENTS.md with development commands, quirks, and style conventions
- PR CI workflow configuration
- bsk CLI auto-update placeholder

### Changed
- Documentation updates across README, README.zh-CN, and SKILL.md
- Pro repo URL update
- WebSocket connection URL as build-time variable for extension

### Fixed
- Biome and Stylelint formatting issues
- pnpm lint pipeline compliance

### Notes
See full git history for detailed commit information between tags.

---

## Version History

| Version | Date | Type | Key Features |
|---------|------|------|--------------|
| **[v0.2.0 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)** | 2026-07-24 | Major Feature Release | Profile Template System (CRUD + apply), CLI/WS/IPC/Popup UI |
| **[v0.1.8 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.8)** | 2026-07-22 | Major Feature Release | bsk record, bsk network, invoke enhancement, session timeout fixes |
| **[v0.2.0 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)** | 2026-07-17 | Feature Release | Dry-run mode, env vars, human timeout, shell completion, CI fixes |
| **[v0.1.7 / v0.1.3](https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.7)** | 2026-07-16 | Feature Release | bsk invoke command, Windows compatibility, transport layer |
| v0.1.6 / v0.1.2 | Earlier | Patch/Maintenance | Bug fixes, minor improvements |
| v0.1.5 / v0.1.1 | Earlier | Initial Public Release | Core functionality |
| v0.1.4 / v0.1.0 | Earlier | First Release | MVP release |

---

## Links

- **Releases**: https://github.com/916938/browserskill-new/releases
- **Pull Requests**: https://github.com/916938/browserskill-new/pulls
- **Issues**: https://github.com/916938/browserskill-new/issues
- **Documentation**: See `skill/SKILL.md` for user-facing docs, `AGENTS.md` for developer guide

---

[CLI v0.2.0]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0
[CLI v0.1.8]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.8
[Extension v0.1.4]: https://github.com/916938/browserskill-new/releases/tag/ext-v0.1.4
[CLI v0.1.7]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.7
[Unreleased]: https://github.com/916938/browserskill-new/compare/cli-v0.2.0...HEAD
