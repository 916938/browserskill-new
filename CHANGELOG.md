# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- (No planned features yet)

### In Progress
- No active development since v0.2.0/v0.1.4 release (2026-07-17)

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
| **[v0.2.0 / v0.1.4](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)** | 2026-07-17 | Major Feature Release | Dry-run mode, env vars, human timeout, shell completion, CI fixes |
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

[CLI v0.2.0]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0
[Extension v0.1.4]: https://github.com/916938/browserskill-new/releases/tag/ext-v0.1.4
[CLI v0.1.7]: https://github.com/916938/browserskill-new/releases/tag/cli-v0.1.7
[Unreleased]: https://github.com/916938/browserskill-new/compare/cli-v0.2.0...HEAD
