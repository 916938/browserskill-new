# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- (No planned features yet)

### In Progress
- Active development since 2026-07-17 with multiple feature releases

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
| **[v0.1.8 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.8)** | 2026-07-22 | Major Feature Release | bsk record, bsk network, invoke enhancement, session timeout fixes |
| **[v0.2.0 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)** | 2026-07-17 | Feature Release | Dry-run mode, env vars, human timeout, shell completion, CI fixes |
| **[v0.1.7 / v0.1.3](https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.7)** | 2026-07-16 | Feature Release | bsk invoke command, Windows compatibility, transport layer |
| **v0.1.6 / v0.1.2** | Earlier | Patch/Maintenance | Bug fixes, minor improvements |
| **v0.1.5 / v0.1.1** | Earlier | Initial Public Release | Core functionality |
| **v0.1.4 / v0.1.0** | Earlier | First Release | MVP release |

---

## Links

- **Releases**: https://github.com/916938/browserskill-new/releases
- **Pull Requests**: https://github.com/916938/browserskill-new/pulls
- **Issues**: https://github.com/916938/browserskill-new/issues
- **Documentation**: See `skill/SKILL.md` for user-facing docs, `AGENTS.md` for developer guide

---

[CLI v0.1.8]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.8
[CLI v0.2.0]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0
[Extension v0.1.4]: https://github.com/916938/browserskill-new/releases/tag/ext-v0.1.4
[CLI v0.1.7]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.7
[Unreleased]: https://github.com/916938/browserskill-new/compare/cli-v0.1.8...HEAD
