---
name: browser-skill
description: |
  Use when the user asks to perform browser automation tasks against their
  logged-in Chromium browser: visit and read pages, fill forms, scrape data,
  click through a flow, regression-test a PR's UI, validate a deployed page,
  or target a connected browser instance by smart label or instance id.
  Requires the bsk CLI installed and the matching browser-skill extension
  loaded.
---

# browser-skill

Drive the user's **real Chromium browser** (with their logins and cookies) through the `bsk` CLI. The extension opens an isolated **Agent Window** for automation; the user's normal windows stay protected unless you explicitly borrow a tab.

## When to use

- Open pages, read titles/text, scrape structured data from sites the user can already access
- Fill forms, click through multi-step flows, smoke-test a UI change
- Understand pages with `bsk snapshot` first; use `bsk get-html` or `bsk screenshot` only when the snapshot is insufficient
- Operate on a specific user tab they point you at (after `bsk tab borrow`)
- Target a specific connected browser instance after resolving its smart label or `instance_id` with `bsk browsers`

## When NOT to use

- Tasks with **no browser** involved (files, APIs, databases only)
- Installing or configuring the extension (point the user to setup docs instead)
- **Credential harvesting** — never run `bsk evaluate` on banking, SSO, or password-manager pages to extract tokens, cookies, or secrets
- Long-lived control of a user's personal login window — borrow only for the immediate step, then `bsk tab return` or end the session
- Replacing the user's manual browsing when they only wanted an explanation

## Prerequisites

1. `bsk` on `PATH` (Rust CLI from browser-skill)
2. browser-skill **extension** loaded in Chromium and connected (popup shows green)
3. CLI, daemon, and extension must use matching protocol versions; version skew exits with code `5`
4. Any `bsk` command auto-starts background services as needed; use `bsk doctor` if anything fails

## Mandatory workflow

Every automation task **must** follow this lifecycle. Do **not** rely on idle timeouts (default session idle is 5 minutes).

```
1. bsk session start              → capture the 4-letter session id printed on stdout
2. … every tool command …        → always pass --session <id>
3. bsk session stop <id>          → REQUIRED when done (even on error paths)
```

Optional: when multiple browsers are connected, run `bsk browsers` first, then start with `bsk session start --browser <instance-id-or-label>`. Add `--no-focus` to open the Agent Window in the background without stealing focus from the user's current window. Follow **Multi-browser targeting and smart labels** below; do not guess among ambiguous labels.

Emergency cleanup: `bsk session stop --all` or the Agent Window overlay **Stop all**.

## Multi-browser targeting and smart labels

The base CLI and extension implement browser-instance discovery and selection:

- `bsk browsers` lists connected instances with their `instance_id`, editable smart label, browser version, and active sessions.
- `bsk session start --browser <instance-id-or-label>` starts a session on the selected connected instance.
- `instance_id` is the stable, unique routing key. A smart label is an editable human-readable alias and may be duplicated.
- If a label is duplicated, missing, or offline, do not guess. Re-run `bsk browsers` and use the full `instance_id`, or ask the user which instance to target.
- Label edits are made in the extension Popup, acknowledged by the daemon, and may briefly reconnect the extension. Re-run `bsk browsers` after a label change; do not cache label-to-id mappings across tasks.
- Each Chromium Profile has its own browser-managed cookies, Local Storage, extension data, and login state. This is Chromium Profile behavior; smart labels only identify connected instances.
- Do not switch an active session to another instance. Stop it and start a new session against the intended instance.

```bash
bsk browsers --json
bsk session start --browser <full-instance-id> --no-focus
# ... always pass --session <id> ...
bsk session stop <id>
```

## Stop when the goal is met

Every task is a **bounded goal**, not open-ended browsing. The goal may come from the user's request, a recorded `trace.json`, or both.

1. **Define success first** — one concrete, observable condition derived from the user's words, `purpose`, or the last meaningful step in a trace (e.g. "form submitted", "item added to cart", "playback started").
2. **Take the shortest path** — snapshot → act → at most one check. Do not wander, re-try unrelated actions, or stack exploratory steps.
3. **Stop as soon as success is reached** — run `bsk session stop <id>` immediately unless the user explicitly asked to keep the session open (e.g. "don't close yet", "keep browsing").
4. **No post-success work** — once the goal is met, do not click, refresh, navigate, re-search, switch tabs, or "double-check" that it worked. Further verification is a new task.
5. **When blocked, pause — do not brute-force** — if the page requires human input (login, captcha, OTP, payment confirmation) or an action fails twice with no progress, call `bsk request-help` instead of retrying blindly. See **Ask the human for help** below.
6. **When unsure** — at most one extra `bsk snapshot`. If success looks met, stop. If not, ask the user; do not keep clicking.

**With a trace:** replay steps in order using `target` role/name/tag and raw `value`/`selection` fields. After the last step (or when its `effect.navigated_to` / success hint is satisfied), apply rules 3–4 immediately. The trace guides execution; it does not extend control beyond the goal.

**Without a trace:** the user's request *is* the success condition. Satisfying it ends the task — same stop rules apply.

## Core interaction loop

Write operations only affect tabs in the **Agent Window** (or tabs you **borrowed** into it).

```
bsk navigate <url> --session <id>
bsk observe --session <id>           → primary semantic VOM view; reveals hover/focus surfaces
bsk snapshot --session <id>          → static aria tree fallback when VOM is insufficient
bsk hover @e3 --session <id>          → reveal hover-triggered menus before re-observing/clicking
bsk click @e4 --session <id>          → or bsk fill, bsk select, bsk press
bsk observe --session <id>             → again after navigation / DOM change
```

**Refs invalidate after navigation** — always re-snapshot before clicking, filling, or selecting on a new page.

Prefer `@eN` refs from the latest snapshot over raw CSS selectors. Use `--ref` / `--selector` when ambiguous (`bsk click --help`).

When VOM renders `[hover first: …]` on an element, the listed items are not currently clickable refs. Run `bsk hover <that-ref> --session <id>`, then immediately run `bsk snapshot` or `bsk observe` again and click the newly visible menu item ref. Do not click the trigger itself unless the user explicitly wants the trigger action.

### Quick decision tree

- Need the user's existing login state or current tab? `bsk tab list --scope user` → `bsk tab borrow <tab-id>` → snapshot.
- Need an isolated tab you can close later? `bsk navigate <url>` in the Agent Window.
- Multiple browsers connected? `bsk browsers` to list, then `bsk session start --browser <id-or-label>`.
- Page size unknown? `bsk snapshot` first; use `bsk screenshot` only if the snapshot is insufficient.
- After navigation or a click that should change the page? Re-snapshot; old `@eN` refs are stale.

## Observation priority

Start with `bsk observe` to understand page structure, text, controls, element refs, and conditional hover/focus surfaces. Use `bsk snapshot` only when you need the stricter static accessibility tree or VOM is insufficient. Only escalate to raw HTML or screenshots when the latest observation cannot answer the question:

1. `bsk observe` — primary semantic VOM observation; may run bounded perception probes such as hover-surface discovery
2. `bsk snapshot` — strict static accessibility tree fallback
3. `bsk get-html` — when hidden DOM, metadata, or markup details are required
4. `bsk screenshot` — when visual layout, canvas/image content, or styling cannot be inferred from the observation. Use `--ref @eN` (from the latest snapshot/observe) to crop to one element; omit `--ref` for the full visible tab.

Do **not** call `bsk get-html` or `bsk screenshot` first just to inspect a page.

## Sandbox rules

| Rule | Detail |
|------|--------|
| Agent Window | `bsk tab create`, `bsk navigate`, `bsk click`, etc. work on agent tabs by default |
| User tabs | Read-only until borrowed: `bsk tab list --session <id> --scope user` then `bsk tab borrow <tab-id> --session <id>` |
| Return borrowed tabs | Call `bsk tab return <tab-id> --session <id>` when finished; unreturned tabs are **auto-returned** on `bsk session stop` |
| Writes off-agent | Commands that mutate the page fail if the tab is not in the Agent Window — borrow or create a tab first |

## Global flags

| Flag | Purpose |
|------|---------|
| `--json` | Machine-readable JSON on stdout (errors too) |
| `--quiet` | Suppress informational stderr |
| `-v` / `-vv` | More verbose logging |

Auto-update is **on by default** — the background daemon upgrades `bsk` itself when a new release is available (postponed while a session is active). Set `BSK_AUTO_UPDATE=off` to disable it and upgrade manually with `bsk update`.

Command-specific flags (timeouts, `--tab-id`, `--wait-until`, …): **`bsk <cmd> --help`**

## CLI command reference (one line each)

Details and flags: **`bsk <cmd> --help`**

### Diagnostics

| Command | Summary |
|---------|---------|
| `bsk status` | Connection health, connected browsers, active sessions |
| `bsk doctor` | Deep diagnostics and repair hints |
| `bsk browsers` | List connected browser instances (ids, labels, versions) |

### Session

| Command | Summary |
|---------|---------|
| `bsk session start` | Open Agent Window (`--width`/`--height` for initial size); prints **4-letter session id** |
| `bsk session start --no-focus` | Open Agent Window in the background without stealing focus |
| `bsk session stop <id>` | End session, close Agent Window, auto-return borrowed tabs |
| `bsk session stop --all` | Stop every active session |
| `bsk session list` | List active sessions |

### Window (require `--session <id>`)

| Command | Summary |
|---------|---------|
| `bsk window resize` | Resize the Agent Window (`--width`, `--height`; 100..=7680 CSS px) |

### Device emulation — `bsk emulate` (requires `--session <id>`)

Emulate a mobile device environment on the agent tab via CDP — viewport, User-Agent, and touch — to debug a page's mobile layout and behaviour:

```bash
bsk emulate --session <id> --device iphone-14
bsk emulate --session <id> --width 390 --height 844 --dpr 3 --mobile --ua "Mozilla/5.0 (iPhone…" --touch
bsk emulate --session <id> --off
```

- Presets (`--device`): `iphone-14`, `iphone-14-pro-max`, `iphone-se`, `pixel-7`, `galaxy-s23`, `ipad-mini`, `galaxy-tab-s8`. Manual flags (`--width`/`--height`/`--dpr`/`--mobile`/`--ua`/`--accept-language`/`--touch`/`--max-touch-points`) also work without a preset, or override individual preset fields; `--no-mobile`/`--no-touch` turn a preset's mobile viewport / touch emulation back off.
- Repeated runs merge field by field onto the tab's current emulation state — only the flags you pass change. E.g. after `--device iphone-14`, `bsk emulate --session <id> --width 390 --height 844` keeps the preset's dpr (`3`) and mobile viewport. (The extension remembers the state per tab; after an extension reload the next run applies only the fields it carries.)
- `--off` clears every override (viewport, UA, touch) and the remembered state, restoring the tab's real environment.
- Scope: overrides apply to **one tab only** (CDP per-target) and are **not inherited by new tabs** — re-run `bsk emulate` after opening or switching to another tab (default target is the session's active tab; `--tab-id` overrides).
- Emulation covers viewport/UA/touch only; it does not throttle the network, fake geolocation, or synthesise real touch-event streams.

### Tabs (require `--session <id>`)

| Command | Summary |
|---------|---------|
| `bsk tab list` | List tabs (`--scope user\|agent\|all`, default `all`) |
| `bsk tab create` | New tab in Agent Window (`--url`, `--no-active`, `--index`) |
| `bsk tab close <tab-id>` | Close an agent tab |
| `bsk tab select <tab-id>` | Focus an agent tab |
| `bsk tab borrow <tab-id>` | Move a user tab into the Agent Window |
| `bsk tab return <tab-id>` | Return a borrowed tab to its original window |

### Observation (require `--session` unless noted)

| Command | Summary |
|---------|---------|
| `bsk snapshot` | First-choice static page understanding: accessibility tree with `@eN` element refs |
| `bsk observe` | Semantic VOM observation with bounded perception probes for conditional surfaces |
| `bsk get-html` | Raw HTML dump after snapshot is insufficient (high token cost) |
| `bsk screenshot` | PNG capture after snapshot is insufficient: full visible tab, or `--ref @eN` to crop to one element (`--out` path optional) |

### Console & network debugging (read-only; require `--session`)

| Command | Summary |
|---------|---------|
| `bsk console` | Buffered page console messages, JS exceptions, and browser log entries (`--include-stack` for stack traces) |
| `bsk network` | Buffered network responses (status, method, URL, MIME/resource type) and failures (`net::ERR_*` reason) |

Both capture from the moment the tab is attached and read a bounded per-tab buffer: `--since <seq>` pages from a cursor (`next_since` in the result), `--limit` (default 50, max 200), `--max-text-chars` (default 1000, max 4096), `--tab-id` to target a non-active tab. Both are strictly read-only — they never intercept or modify traffic, and request/response headers, bodies, and timings are not captured.

### Navigation

| Command | Summary |
|---------|---------|
| `bsk navigate <url>` | Go to URL in agent tab (`--wait-until`, `--timeout`) |
| `bsk navigate-back` | History back one step |
| `bsk navigate-forward` | History forward one step |
| `bsk reload` | Reload current tab (`--hard` bypass cache) |

(`bsk navigate back` / `bsk navigate forward` are equivalent subcommands.)

### Interaction

| Command | Summary |
|---------|---------|
| `bsk click <ref-or-selector>` | Click element (`--button`, `--click-count`, `--modifiers`) |
| `bsk hover <ref-or-selector>` | Move the mouse to an element and wait for hover UI to settle (`--settle`, `--modifiers`) |
| `bsk fill <ref-or-selector> --value <text>` | Clear and type into input |
| `bsk select <ref-or-selector> --value <v>` | Set `<select>` option(s) by `value` (repeat `--value` for multi-select) |
| `bsk press <key>` | Key/combo (`Enter`, `Ctrl+A`, …; optional `--ref` to focus first) |

### Scripting & timing

| Command | Summary |
|---------|---------|
| `bsk evaluate <expression>` | Run JS in agent tab (see red lines); JS throw → stderr, **exit 0** |
| `bsk wait-for-navigation` | Block until load/DOM idle/etc. (`--wait-until`, `--timeout`) |
| `bsk wait-ms <duration>` | Sleep (`500ms`, `2s`, `1m`; **no** `--session`) |
| `bsk invoke --action <name>` | Forward raw JSON to any tool RPC (`tool.*`) |
| `bsk invoke --action <name> --dry-run` | Preview request without executing |

### Generic passthrough — `bsk invoke`

`bsk invoke` sends a raw JSON params object to any `tool.*` RPC, bypassing
the typed subcommand layer. This is the backend for shell helpers like
`invoke.sh` / `invoke.ps1`.

**Key flags:**

| Flag | Purpose |
|------|---------|
| `--action <name>` | Tool action: `fill`, `snapshot`, or qualified `tool.fill` |
| `--session <id>` | Session id (merged into params as `session_id`) |
| `--timeout <dur>` | Hard timeout; accepts `30s`, `1m`, `1500ms`, or bare ms (default `30s`) |
| `--args-json '{...}'` | Raw JSON object of arguments (mutually exclusive with `--args-file`) |
| `--args-file <path>` | Path to JSON file, or `-` for stdin |
| `--dry-run` | Validate and preview without sending to daemon |

**Timeout format:** `30s` (seconds), `1m` (minutes), `500ms`, or bare number (milliseconds).
Backward compatible: `--timeout-ms` is an alias.

**Dry-run output** (`--dry-run`): Prints structured preview (action, method, session,
params, timeout) without contacting the daemon. Use to debug argument construction
or validate payloads before execution.

### Profile templates — `bsk templates`

Profile Templates currently provide template metadata/CRUD and controlled apply responses. They do not automatically capture the current Profile's live cookies or storage into a template; do not describe them as a live account backup or migration mechanism.

| Command | Summary |
|---------|---------|
| `bsk templates list` | List template summaries (id, name, cookie/storage counts, User-Agent flag, updated time) |
| `bsk templates get <id>` | Show full template metadata and stored entries |
| `bsk templates create --name <name> [--description <text>] [--user-agent <ua>]` | Create an empty template with optional metadata/User-Agent |
| `bsk templates update <id> [--name <name>] [--description <text>] [--user-agent <ua>]` | Update template metadata; pass an empty User-Agent to clear it |
| `bsk templates delete <id>` | Delete a template by id; confirm the id before destructive cleanup |
| `bsk templates apply <id> [--scope all\|cookies\|storage\|user-agent]` | Apply the selected template scope to the current browser Profile |

Rules:

- `bsk templates apply` currently returns the selected template and application counts; do not assume CLI output alone proves that browser cookies, storage, or User-Agent changed. Verify only behavior explicitly supported by the installed extension/version.
- Use `--scope` instead of `all` when only one category is required. Treat `cookies` and `storage` as sensitive account state.
- Never create, print, export, or apply templates containing credentials, session tokens, password-manager data, payment data, or unrelated personal data unless the user explicitly requests a legitimate controlled operation and confirms the exact scope.
- Do not use templates to merge accounts, bypass login, or copy a live account's authentication state into another account. Prefer a new isolated Profile and normal user authentication.
- After applying a template, observe the target page and verify only the requested non-sensitive result; do not dump cookies or storage to verify it.

Examples:

```bash
bsk templates list --json
bsk templates get <template-id> --json
bsk templates apply <template-id> --scope user-agent
```

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BSK_DEFAULT_SESSION` | Default session id when `--session` is omitted | _(none)_ |
| `BSK_INVOKE_TIMEOUT_MS` | Override default timeout in milliseconds | `30000` |

### Shell completion

Generate tab-completion scripts for your shell:

```bash
# Bash (add to ~/.bashrc):
bsk completion bash > ~/.local/share/bash-completion/completions/bsk

# Zsh (add to ~/.zshrc):
bsk completion zsh > "${fpath[1]}/_bsk"

# Fish (auto-discovered):
bsk completion fish > ~/.config/fish/completions/bsk.fish

# PowerShell (add to Profile):
bsk completion powershell | Out-File -Encoding utf8 $PROFILE
```

### Ask the human for help — `bsk request-help`

When a step needs a human (captcha, login, OTP) or you want the user to
confirm an important action, pause and ask:

    bsk request-help --session <id> --prompt "Solve the captcha, then click Done only after the site accepts it" \
      --title "Captcha required" --target @e7 --target "#submit" --timeout 5m

- `--prompt` (required): what the user should do.
- `--title` (optional): custom title for the overlay panel. When omitted,
  the extension shows its default localized title.
- `--target` (repeatable): a snapshot ref (`@e7`) or CSS selector
  (`#submit`) to scroll to and flash-highlight. **Strongly recommended** —
  whenever the prompt refers to a concrete element (a button to click, a
  field to fill, a checkbox to toggle), pass its `@eN` ref / selector so the
  user is guided straight to the right spot instead of hunting for it. For
  interaction scenarios, always include the relevant target(s); reserve a
  prompt with no `--target` for cases where there is genuinely no specific
  element to point at (e.g. "wait for the page to finish loading").
- `--timeout` (default `5m`): how long to wait.
- `--completion-criteria` (optional): JSON success detector. Use it only
  when there is a concrete post-help success signal, e.g.
  `{"any":[{"url_contains":"/dashboard"},{"selector_exists":"[data-testid='account-menu']"}],"stable_for_ms":1000}`.

The target tab is brought to the foreground; the page stays interactive
while the agent control mask is hidden. The call blocks until the user
explicitly acts, the timeout expires, cancellation arrives, or explicit
completion criteria match. Page reloads, SPA route changes, and captcha
refreshes do not return control by themselves. The result `outcome` is one of:

- `continued` — the user finished and clicked Done / return control (treat as confirm).
- `cancelled` — the user clicked Cancel (treat as reject/abort).
- `timed_out` — nobody acted within the timeout.
- `completed` — the explicit `--completion-criteria` matched while the user had control.
- `navigated` — deprecated legacy outcome. Do not rely on navigation as a completion signal.

`note` carries any text the user typed back. `resolved_targets` reports
which refs/selectors matched a live element.

`request-help` does not refresh the page model after the user returns
control. After a `continued` or `completed` result, issue a separate
observation tool call (usually `bsk snapshot --session <id>`) before using
new refs or reasoning about the post-help page state.
#### Disabling request-help (unattended mode)
Set `BSK_REQUEST_HELP=off` on unattended servers: `bsk request-help` then
returns immediately with `outcome="disabled"` (no overlay, no waiting,
exit 0). Any other value keeps it enabled. If you get `disabled`, do not
retry — complete the task autonomously or stop gracefully.

### Recording — `bsk record`

Capture the user's own actions in the Agent Window to a `trace.json`, for later LLM-driven automation:

```bash
bsk record start --browser <instance-id-or-label> [--url https://…] [--purpose "publish a wiki doc"] [--output trace.json]
# `--url` is optional; default https://example.com/ when omitted (must be http(s)).
# Blocks until the user clicks Finish in the recording panel, then writes ./trace.json and closes the window.

bsk record stop [--output trace.json]   # terminal fallback if the browser panel is unavailable
```

- The trace is a **record-only action log** (a `pages[]` dictionary + `navigate`/`click`/`fill`/`select`/`press` steps with `target` descriptors). It records *what the user did*; deciding which inputs are variable is left to the executing agent.
- `--purpose` is optional context metadata; it does **not** change what gets captured.
- There is **no** `bsk replay` — to redo a flow, read the trace and reuse the existing `session` / `snapshot` / `@eN` / `click` / `fill` tools. Follow **Stop when the goal is met**.
- Do **not** record on banking/SSO/password-manager pages; passwords are redacted but traces may still contain sensitive text.

## Error handling

### Exit codes (`echo $?` after `bsk …`)

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | Success (including `evaluate` where JS threw but RPC succeeded) | Continue |
| `1` | User error — bad args, unknown session, tab not in Agent Window, stale ref | Fix args; `bsk session list`; re-snapshot |
| `2` | Protocol / transport — service unreachable, IPC failure | `bsk doctor`; check extension connected; retry the command |
| `3` | Browser / CDP execution failed | Retry; simplify selector; check tab still open |
| `4` | Timeout | Increase `--timeout`; try `--wait-until domcontentloaded` |
| `5` | Version skew (CLI vs extension) | Upgrade/reinstall matching versions |

Human errors print `error:` + `hint:` on stderr; `--json` includes `code`, `message`, `hint`, `exit_code`.

### When to run diagnostics

| Situation | Command |
|-----------|---------|
| Before first task in a session | `bsk status` — extension connected? |
| Any failure you cannot fix in one retry | `bsk doctor` |
| Multiple browsers / wrong target | `bsk browsers` then `bsk session start --browser <id>` |

Always **`bsk session stop <id>`** in a `finally`-style path so the Agent Window closes and borrowed tabs return.

## Red lines

1. **No token theft** — do not `bsk evaluate` on sensitive sites to read `localStorage`, cookies, or auth headers for exfiltration.
2. **No long borrow** — do not leave a user's personal tab in the Agent Window across unrelated tasks.
3. **No skip stop** — always `bsk session stop <id>`; never assume idle timeout will clean up.
4. **No post-success control** — once the user’s goal (or last trace step) is met, do not keep operating the page; stop the session unless they asked to keep it open.
5. **No raw observe escalation before snapshot/observe** — use `bsk snapshot` first; use `bsk observe` when VOM semantics or conditional surfaces help. Only use `bsk get-html` or `bsk screenshot` when snapshot/observe is insufficient. Element screenshots (`--ref @eN`) still require a fresh snapshot/observe ref — never skip observation just to grab a visual.
6. **`evaluate` is powerful and risky** — use only when snapshot + click/fill/select cannot suffice; never on credential surfaces.
7. **No ambiguous instance targeting** — smart labels are editable aliases, not isolation or authorization controls; use the full `instance_id` when a label is ambiguous.

---

**More detail for any command:** `bsk <cmd> --help`
