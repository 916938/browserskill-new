# BrowserSkill `chain` Upstream Merge Release Notes

**Status:** Unreleased post-merge build  
**Merge Date:** 2026-08-15  
**Merge Commit:** `cfbc286ea4876e7082279f9a957e3b02ad59d7e2`

> These notes describe the `chain` branch after merging `Tencent/main`. They are not attached to an existing version tag. The existing `cli-v0.2.1` and `ext-v0.1.6` tags predate this merge and do not contain the complete change set documented here.

## Overview

This merge combines 31 commits unique to `chain` with 73 commits unique to `Tencent/main`. It preserves the local Profile Templates, browser label, and `bsk invoke` work while integrating upstream VOM observation, hover recording, device emulation, Agent Window, connection lifecycle, update, and Windows compatibility changes.

Compared with the pre-merge `chain` head, the merge changes 161 files with 22,707 insertions and 1,385 deletions.

## Highlights

### Semantic VOM Observation

- Added the `@browser-skill/vom` workspace package.
- Added VOM types, layers, rendering, capture, and tests.
- Expanded `bsk observe` and extension-side semantic observation.
- Added hover-first guidance for conditionally visible controls.

### Hover and Recording

- Added hover actions and hover-aware protocol schemas.
- Added hover candidate detection and hover-trigger policy.
- Added hover-surface recording and improved recorded target descriptions.
- Improved recording overlays and preserved timers across navigation.
- Suppressed extension overlays while screenshots are captured.

### Mobile Emulation

- Added CLI, protocol, and extension support for mobile emulation.
- Supports viewport, User-Agent, touch, and user-agent metadata overrides.
- Added generated schemas and focused tests for emulate parameters and results.

### Agent Window

- Added Agent Window management and window resizing.
- Added session startup width and height options.
- Added `--no-focus` support for unfocused Agent Window startup.

### Reliability and Lifecycle

- Made tool cancellation cooperative.
- Hardened WebSocket handshake and reconnect behavior.
- Added heartbeat and connection generation tracking.
- Added session cleanup after disconnect.
- Prevented rejected or half-open connections from entering retry loops.

### Screenshot Improvements

- Added CDP screenshot fallback when `captureVisibleTab` fails.
- Added capture-suppression messaging to hide overlays during screenshots.

### Update, Install, and Windows

- Added periodic daemon update checks and automatic CLI upgrade support.
- Added staged Windows executable replacement.
- Added release archive checksum verification.
- Changed Windows named-pipe names to hash-only identifiers.
- Updated Windows and Unix installation scripts.

### Popup and Extension UX

- Added a persistent toggle for Agent control hints.
- Added a shared accessible Switch component.
- Retained Profile Templates and browser label editing from `chain`.
- Updated English and Chinese extension localization keys.

### CLI and Protocol

- Retained `bsk invoke` raw JSON RPC passthrough and related enhancements.
- Retained Profile Template CRUD and apply commands.
- Added or expanded observe, hover, emulate, window, session, record, and request-help methods.
- Replaced boolean mutation classification with explicit method effects:
  - `ControlPlane`
  - `PassiveRead`
  - `TransientInput`
  - `BrowserMutation`

## Compatibility

The merge is additive at the CLI and extension feature level, but it substantially expands protocol and runtime behavior. CLI and extension builds should be updated together when testing the post-merge branch.

The source versions currently remain:

```text
CLI / bsk workspace: 0.2.1
Extension:            0.1.6
```

These version values already existed before the merge. A future release should use a new version/tag or otherwise explicitly identify the merge commit to avoid ambiguity with the existing tags.

## Conflict Resolution

The merge resolved conflicts across Cargo versions, CLI dispatch, protocol effects, extension background wiring, popup UI/tests, connection lifecycle, skill harnesses, and duplicated SKILL documentation.

Key decisions:

- Kept CLI and protocol source version `0.2.1`.
- Combined templates and invoke commands with upstream hover, emulate, and window commands.
- Kept label-driven reconnect behavior alongside cancellable handshakes.
- Kept Windows Hermes behavior alongside Kimi Code harness support.
- Kept Profile Templates and label editing alongside the control-hints popup toggle.
- Regenerated `pnpm-lock.yaml` after detecting an incomplete merged dependency entry.

## Verification

The post-merge branch passed:

```text
cargo build -p bsk
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo fmt --all -- --check
pnpm --filter @browser-skill/extension exec wxt prepare
pnpm --filter @browser-skill/extension compile
pnpm ext:test
node --test scripts/*.test.mjs
```

Results:

```text
Rust:       121 passed, 0 failed
Extension:  788 passed across 55 files, 0 failed
Node:       1 passed, 0 failed
```

No unresolved Git conflict markers were found.

## Known Release Preparation Items

- Choose a new CLI and extension version or explicitly release from merge commit `cfbc286`.
- Create new tags that include the merge; do not reuse the existing `cli-v0.2.1` or `ext-v0.1.6` tags.
- Verify the full CI and packaging workflows before publishing artifacts.
- Review the extension-id allow-list TODO in `crates/bsk-cli/src/daemon/ws.rs` before a security-sensitive GA release.

## Supporting Documents

- `UPGRADE_MERGE_SUMMARY.md`: detailed Chinese upgrade and merge summary.
- `MERGE_REVIEW.md`: merge review findings and release documentation assessment.
- `CHANGELOG.md`: concise unreleased change history.
