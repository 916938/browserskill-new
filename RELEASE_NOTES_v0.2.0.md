# BrowserSkill v0.2.0 (CLI) & v0.1.4 (Extension) Release Notes

**Release Date**: 2026-07-24
**Tag**: `cli-v0.2.0` | `ext-v0.1.4`

---

## Profile Template System (Major New Feature)

The headline feature of this release is a complete **Profile Template System** for managing and applying browser profile templates.

### What It Does

Save and restore browser profile state across sessions:
- **Cookies** - Preserve login sessions, authentication tokens
- **Storage** (`chrome.storage.local`) - Save app data, preferences
- **User-Agent** - Switch browser identity for testing

### Architecture

```
┌─────────────┐     WS/IPC      ┌─────────────┐
│  Extension  │ ◄────────────► │   Daemon    │
│ (Chrome/Edge)│               │  (Rust)     │
└─────────────┘                └──────┬──────┘
                                      │
                               ┌──────▼──────┐
                               │   Templates  │
                               │ ~/.bsk/templates/
                               └─────────────┘
```

### CLI Commands

```bash
# List all templates
bsk templates list --json

# Create a new template
bsk templates create --name "Production" --description "Prod profile"

# Get template details
bsk templates get <template-id>

# Update a template
bsk templates update <template-id> --name "Updated Name"

# Delete a template
bsk templates delete <template-id>

# Apply a template (scope: all | cookies | storage | user-agent)
bsk templates apply <template-id> --scope all
```

### Popup UI

The extension popup now includes a **Templates** tab with:
- Template list with summary info (name, cookie count, storage count)
- Create/Edit/Delete operations
- Scope selector for apply (All / Cookies / Storage / User-Agent)
- Toast notifications for success/error feedback
- Full i18n support (zh-CN + en-US)

### Protocol API

New RPC methods available via WebSocket or IPC:

| Method | Description |
|--------|-------------|
| `template.list` | List all templates (summaries) |
| `template.get` | Get full template by ID |
| `template.create` | Create a new template |
| `template.update` | Update existing template |
| `template.delete` | Delete a template |
| `template.apply` | Apply template to current profile |

### Stats

- **27 files changed**
- **+4,020 / -8 lines**
- **20 new Rust unit tests**
- **44 new TypeScript tests**
- Total: **476 TS + 233 Rust tests passing**

---

## Installation

### CLI (bsk)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/916938/browserskill-new/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/916938/browserskill-new/main/install.ps1 | iex
```

**Manual Download:**
- [darwin-arm64](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)
- [darwin-x64](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)
- [linux-x64](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)
- [linux-arm64](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)
- [windows-x64](https://github.com/916938/browserskill-new/releases/tag/cli-v0.2.0)

### Extension (Chrome/Edge)

1. Download: [extension-v0.1.4.zip](https://github.com/916938/browserskill-new/releases/tag/ext-v0.1.4)
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → select extracted folder
5. Or drag `.zip` directly into Edge

---

## Quick Start

```bash
# 1. Start daemon
bsk daemon start

# 2. Create a template from current session
bsk templates create --name "My Session" --save-current

# 3. Later, restore it
bsk templates list
bsk templates apply <template-id> --scope all
```

---

## Changelog (since v0.1.8 / v0.1.3)

### Added
- **Profile Template System** - Complete CRUD + apply for browser profiles (#4)
- Template persistence in `~/.bsk/templates/{uuid}.json`
- Popup UI with template management interface
- i18n keys for template UI (zh-CN, en-US)

### Changed
- Extension manifest: added `cookies` permission for template apply
- Protocol version updated with template types and methods

### Fixed
- Clippy warnings resolved across all targets (`--all-targets`)
- TypeScript strict typing for i18n keys
- ResponseFrame protocol shape alignment in template-client

---

## Contributors

- @paddlelaw - Feature implementation and PR author

---

## Links

- **GitHub**: https://github.com/916938/browserskill-new
- **PR #4**: https://github.com/916938/browserskill-new/pull/4
- **Issues**: https://github.com/916938/browserskill-new/issues
