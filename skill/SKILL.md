---
name: zenx-bridge
description: |
  Use when the user asks to automate their logged-in Chromium browser: visit
  and read pages, fill forms, scrape data, click through flows, regression-test
  a PR's UI, validate a deployed page, operate a tab they identify, or target a
  connected browser instance by smart label or instance id. Requires the bsk
  CLI and browser extension.
---

# ZenX Bridge

Use `bsk` to work in an **Agent Window** with the user's existing logins. User tabs
require explicit borrowing. This skill does not install the extension or handle
advice-only tasks. Never extract credentials, cookies, tokens, or other secrets.

## Before starting a session

For remote setup or pairing, follow the [remote guide](https://github.com/Tencent/BrowserSkill/blob/main/docs/remote-extension-connection.md).

Local commands normally auto-start the daemon. If the host terminates background
children after each shell call, including on Windows, complete these steps first:

1. Reuse the host daemon's existing `BSK_HOME` (or its default if unset). Set
   `BSK_AUTO_START=0` and run `bsk status --json`. Reuse a working daemon; an empty
   `browsers` list means the extension still needs connecting. Permission errors,
   timeouts or invalid replies do not prove the daemon is absent.
2. Only if the check reports a missing daemon and no host task is already starting
   it, run `bsk daemon start --foreground` with the same `BSK_HOME` in the host's
   approved persistent background task outside the per-command sandbox. Keep that
   task alive; `--foreground` alone cannot prevent host cleanup. The
   [sandbox guide](https://github.com/Tencent/BrowserSkill/blob/main/docs/sandboxed-agents.md)
   covers the normal host-terminal alternative and PowerShell examples.
3. After launching, or if a host task is already starting the daemon, run
   `bsk status --json` in a **separate shell tool call** with the same `BSK_HOME`
   and `BSK_AUTO_START=0`. While startup is pending, make at most five
   checks with one-second pauses for missing-endpoint or transient startup errors;
   stop on permission/protocol errors. Proceed only after a successful status
   response. If the host task exits (including a lock error) or readiness never
   succeeds, inspect its output and `bsk logs`, then recheck status for another
   daemon before deciding whether startup is still needed. Report unresolved
   errors; do not loop on launches, delete runtime files or restart a shared daemon.

Use the same `BSK_HOME` and `BSK_AUTO_START=0` on EVERY sandboxed command;
environment settings may not persist between shell calls. Keep browser commands
sandboxed. For other startup failures, retry once, then use `bsk doctor`.
A local process identity warning permits browser commands when IPC works.

## Task workflow

1. Define success from the user's request. Start `bsk session start --json` and
   retain its `session_id`. With multiple browsers, run `bsk browsers` and add
   `--browser <id-or-label>` to start. For background work, add `--no-focus` to
   `session start` only.
2. For a new page, navigate; for an existing user tab, follow **Borrowing** below.
   Read the page before interacting:

   ```sh
   bsk navigate https://example.com --session <id>
   bsk observe --session <id>
   ```

3. Choose an action using fresh refs from that observation. Observe again after
   navigation or meaningful DOM changes. Check an ambiguous result once; once
   success is visible, stop acting rather than refreshing or checking again.
4. Always run `bsk session stop <id>` on success and failure, unless keeping the
   session open is part of the user's request. This also returns borrowed tabs.
   Returned tabs stay open in the user's window. Do not rely on idle cleanup
   or stop/restart the shared daemon to finish a task.

Replace `<id>`, example refs and values with actual results and task inputs.
Every session-scoped command needs `--session <id>`; `session stop` takes the ID
positionally. For unfamiliar commands or flags, consult `bsk --help` or
`bsk <command...> --help` instead of guessing; no need to read all help at startup.
When following a trace, use its semantic targets and values in order, not its old
refs. Stop at the requested goal; a trace grants no additional authorization.

## Read and interact

Prefer `observe` for text, controls and `@eN` refs. Navigation invalidates refs;
large DOM changes can stale them too. Re-observe before the next interaction.
Use refs for iframe/shadow-root targets; CSS selectors search the main document.

Choose the relevant example, using a ref that actually appeared on the page:

| Need | Command |
| --- | --- |
| Click | `bsk click @e3 --session <id>` |
| Fill a field | `bsk fill @e3 --value "text" --session <id>` |
| Select an option | `bsk select @e3 --value "option-value" --session <id>` |
| Press a key | `bsk press Enter --ref @e3 --session <id>` |
| Reveal a hover menu | `bsk hover @e3 --session <id>` |
| Reveal an element | `bsk scroll-to @e3 --session <id>` |
| Scroll with wheel input | `bsk wheel --delta-y 600 --session <id>` |
| Focus or leave a field | `bsk focus @e3 --session <id>` / `bsk blur @e3 --session <id>` |

- `select` uses the option's value, not its visible label.
- Hover markers such as `[hover first: Shoes | Bags]`, `[has-submenu]`, or
  `[expanded]` identify triggers. Hover the trigger, observe, then use the revealed
  item's ref. Listed labels are not refs; do not click the trigger unless its own
  action is wanted. If an expected control is missing and no marker identifies a
  trigger, try `observe --probe-hover` once. It touches the live page and costs
  seconds; use targeted hover once the trigger is known.
- `scroll-to` returns ancestor-clipped bounds in top-level viewport CSS pixels.
  Partial visibility suffices; hidden/fully clipped targets fail. It does not test
  occlusion. `wheel` sends signed deltas (at least one nonzero), not a guaranteed
  scroll distance. An optional target is scrolled into view first; without one,
  input lands at the viewport centre. Observe to check the page's response.

Use `snapshot` for a static accessibility tree, `get-html` for exact markup or
hidden metadata, and `screenshot` for visual content or requested visual evidence.
Do not start with HTML/images just to find ordinary controls; obtain fresh refs
before interacting with controls found that way.

### Large observations

There is no default token cap. With `observe --max-tokens <n>`, follow a returned
`next_cursor`/`@more` when relevant content remains:

```sh
bsk observe --cursor <token> --session <id>
```

Each page replaces the ref map: use its refs before continuing and never reuse
refs from earlier pages. Continuation reads the same capture, without refreshing
or hovering; do not combine it with depth changes or hover probing. New observe/
snapshot or changed page identity invalidates continuation; then observe afresh.

Any `bsk` command auto-starts the background services it needs; never manage the daemon by hand.
Run `bsk doctor` when startup or transport problems persist after one retry.

## Multi-browser targeting and smart labels

- `bsk browsers` lists connected instances with their `instance_id`, editable smart label, browser
  version, and active sessions.
- `bsk session start --browser <instance-id-or-label>` starts a session on the selected instance.
  Add `--no-focus` to that same start command when the Agent Window should not interrupt the user's
  current work; it is not a flag on other commands.
- `instance_id` is the stable, unique routing key. A smart label is an editable alias and may be
  duplicated.
- If a label is duplicated, missing, or offline, do not guess: re-run `bsk browsers` and use the
  full `instance_id`, or ask the user which instance to target.
- Label edits are made in the extension popup and may briefly reconnect the extension. Re-run
  `bsk browsers` after a label change; never cache label-to-id mappings across tasks.
- Each Chromium Profile keeps its own cookies, storage, and login state — smart labels only identify
  connected instances, they do not isolate or authorize anything.
- Do not switch an active session to another instance: stop it and start a new session against the
  intended instance.

## Work toward one observable goal

- Derive a concrete success condition from the user's request or a supplied trace.
- Take the shortest purposeful path: observe, act, then make at most one observation to confirm an
  ambiguous result.
- Once success is visible, do not click, refresh, navigate, switch tabs, or perform extra checks.
- If a human-only step appears or two attempts make no progress, request help instead of
  brute-forcing.

With a trace, follow its semantic target information and values in order, but treat its refs as
record-local hints. Stop when its purpose or last meaningful effect is satisfied. A trace guides the
task; it does not expand the user's goal or authorize additional actions.

## Observe, act, observe

Use this default loop:

```text
bsk navigate <url> --session <id>
bsk observe --session <id>
bsk click|hover|fill|select|press ... --session <id>
bsk observe --session <id>             # after navigation or a meaningful DOM change
```

Prefer fresh `@eN` refs over CSS selectors. Navigation invalidates refs; large DOM changes may also
make them stale. Observe again before the next interaction.

## Borrowing and browser settings

List before borrowing, and return the tab as soon as the relevant step ends:

```sh
bsk tab list --scope user --session <id>
bsk tab borrow <tab-id> --session <id>
bsk tab return <tab-id> --session <id>
```

Borrowing selects the borrowed tab within the Agent Window, preserving the default
for subsequent commands without `--tab-id`. It does not additionally focus the
window. For a background-created tab (`tab create --no-active`), retain the returned
`tab_id` and pass `--tab-id <tab-id>` to observation, navigation and input commands.
Created and borrowed web pages continue running while controlled even after they
move into the background. A default created tab starts at `about:blank`.
Viewport and full-page screenshots of controlled tabs work in the background;
pass `--tab-id` without selecting the target or focusing the window. Prefer
semantic observation first and take a screenshot when the task needs image content.
A viewport screenshot does not issue a Canvas `capture_id`; use the existing
`--ref` flow for screenshot-bound Canvas clicks.

Never invent tab IDs or keep a user tab across unrelated work. Do not repeat
pending, denied or timed-out borrows. For `borrow_outcome_unknown`, inspect tab/
session state first: the tab may already have moved. Do not bypass an outcome
through another browser backend. `tab borrow --timeout 120s` changes only the
confirmation wait (default 60s); custom waits require daemon and extension protocol 1.2+.

The extension's saved Automation settings control borrow confirmation and human
help independently; both default on and apply to existing sessions too. Read
`interaction` in `session start --json` or `session list --json` when needed.
Deprecated `--unattended`, `--no-confirm`, and `BSK_REQUEST_HELP=off` cannot override
these settings. Never change browser storage/settings to bypass them. Human-help
availability does not require permission for every action or grant extra authority.
`request-help` requires daemon protocol 1.3; update CLI, daemon and extension for
full settings support. A feature's version error does not disable other operations.

Remote content reads/actions require task-created or borrowed tabs. Page-opened
popups gain no control automatically; an unowned tab inside the Agent Window
needs the user to move it to a user window before borrowing. Remote upload/download
are unsupported; screenshots work.

## Human steps and recovery

With help enabled, request help for login, CAPTCHA, OTP, payment confirmation,
consent, or after two attempts make no progress:

```sh
bsk request-help --session <id> --prompt "Please complete sign-in" --target @e3
```

Use a precise prompt and fresh targets; omit `--target` when no control fits.
Use completion criteria only for a clear, stable success signal.

| Result | Next step |
| --- | --- |
| Help `continued` / `completed` | Observe again, then resume with fresh refs. |
| Help `cancelled` / `timed_out` | Respect rejection or the blocker; do not repeat the request. |
| Help `disabled` | No human action was confirmed. Re-observe and follow the disabled-help rules below. |
| Stale ref | Observe and retry the intended action once. |
| Unknown tab/session | List current tabs/sessions; never guess IDs or use another task's session. |
| Timeout or unknown effect | Inspect current state before retrying; the action may already have happened. |
| `fill_value_mismatch` | Read the field: formatting may still satisfy the request. Correct only a remaining difference; no blind refill or immediate handoff. |
| Unsupported operation | Use available capabilities; suggest updating only if the missing feature is needed. |

Escalate page reading only as needed:

1. `bsk observe` for normal semantic understanding, text, controls, and refs.
2. `bsk observe --probe-hover` once when an expected control is missing and no marker points at a
   trigger.
3. `bsk snapshot` when a stricter static accessibility tree is more useful.
4. `bsk get-html` for exact markup or hidden metadata that semantic views cannot provide.
5. `bsk screenshot` for layout, styling, canvas, images, or requested visual evidence.

Do not start with raw HTML or screenshots merely to discover ordinary controls. When interaction is
needed, obtain a fresh observation before acting on screenshot or HTML findings.

## Respect the Agent Window boundary

Normal page writes affect only Agent Window tabs. To operate a user tab, first list it with
`bsk tab list --scope user --session <id>`, then `bsk tab borrow <tab-id>`. Return it immediately
after the relevant step with `bsk tab return <tab-id>`; never invent a tab id or keep a personal tab
borrowed across unrelated work.

## Ask the human when needed

Use `bsk request-help` for login, captcha, OTP, payment confirmation, consent, or another step the
user must complete. Give a precise prompt and pass fresh `--target` refs/selectors when concrete
controls can be highlighted. Use completion criteria only when the page has a clear stable success
signal.

The result `outcome` is one of `continued`, `completed`, `cancelled`, `timed_out`, or `disabled`
(`navigated` is deprecated — never treat navigation as a completion signal). Resume only after
`continued` or `completed`. Treat `cancelled` as rejection, and `timed_out` or `disabled` as a
blocker rather than a reason to retry. After control returns, run a fresh `bsk observe` before
reasoning about the page or using refs.

## Command inventory

This list of names is complete. Never invent a command outside it; read
`bsk <command...> --help` for flags instead of guessing them.

```text
session start|stop|list   browsers   browsers close   status   doctor   update   logs
navigate   navigate-back   navigate-forward   reload   wait-for-navigation   wait-ms
observe   snapshot   get-html   screenshot   console   network
click   hover   fill   select   press   evaluate
tab list|create|close|select|borrow|return   window resize   emulate
upload   download   request-help   record start|stop
invoke   templates   completion
```

Required flags that are easy to get wrong:

```text
bsk fill <ref> --value <text>      bsk select <ref> --value <option-value>
bsk screenshot --out <path>        bsk emulate --device <preset-id>
bsk upload <ref> --file <path>     bsk download <ref> --out <path>
```

Navigation alone (including deprecated help outcome `navigated`) is not completion.
For other errors, follow the returned hint and inspect the current state.

- `console` and `network` provide bounded, read-only debugging evidence.
- `console` / `network` accept `--since <n>` (absolute cursor) **or**
  `--since last_action` — the latter means "only what the last action I took
  produced", so you do not have to remember a cursor to ask "what did my click
  cause?". An unknown/never-acted tab returns nothing rather than everything.
- `emulate` applies viewport, user-agent, and touch overrides to one tab; new tabs do not inherit
  them. Use `--off` to restore the real environment.
- `evaluate` is a last resort when observe plus normal interactions cannot complete the task. With
  `--json`, inspect `.ok`: a JavaScript exception may still have CLI exit code 0 because the RPC
  succeeded. Never evaluate credential surfaces to read storage, cookies, or auth data.
- `record` captures a user's actions for later replay. There is no `bsk replay`: to redo a flow,
  read the trace and reuse `session` / `observe` / `click` / `fill`. Do not record banking, SSO,
  password-manager, or other sensitive pages.
- `invoke` forwards a raw JSON params object to any `tool.*` RPC — see **Generic passthrough**
  below.
- `templates` manages Profile Templates — see **Profile templates** below.
- `completion <shell>` prints a tab-completion script for `bash`, `zsh`, `fish`, or `powershell`.

**Help disabled:** do not request help or re-enable it. Use existing login state,
authorized inputs and viable alternatives; disabling help adds no permission and
does not remove borrow confirmation or host restrictions. Where authorized, a
vision-capable model may attempt graphical verification. Phone-only QR scans,
face verification, missing SMS codes or image-only tasks for a text-only model
may remain blocked. Report a specific blocker only when inputs/capabilities are
missing or viable approaches are exhausted; continue independent work. Do not loop
on identical failures, repeat unknown effects or switch backends to bypass limits.
On an unrecoverable failure, report the blocker and stop the owned session.

## Screenshots and Canvas

```sh
bsk screenshot --session <id> --out viewport.png
bsk screenshot --session <id> --ref @e3 --out element.png --json
bsk screenshot --session <id> --full-page --out page.png
bsk screenshot --session <id> --full-page --scope current --out loaded.png
```

Screenshots return a local PNG path; view the image to interpret it. `--out`
replaces an existing file; omitting it uses a temporary path. `--json` includes
dimensions and byte size. `--ref` and `--full-page` cannot be combined.

Full-page mode scrolls an ordinary webpage and restores its position/styles.
The default `--scope follow` follows appended content. Use `--scope current` when
capturing the currently loaded range is requested: it stops at the initial document
height, even if a loading indicator remains. Later content below that boundary is
excluded; report this range rather than claiming all feed entries were loaded.
Use a session-controlled tab and stable viewport; `--tab-id` targets a tab without
selecting it or focusing the window. Switching to another tab does not cancel
capture; navigation, loss of control or a debugger reconnection does.
Internal browser pages, the Web Store, nested scrolling
panels and virtualized lists are unsupported. Capture/encoding defaults to 2m;
`--timeout 5m` extends it only in full-page mode. Allow the shell enough time for
capture plus transfer. Respect cancellation; do not blindly retry endless pages
or substitute a viewport image when an older extension rejects full-page capture.
Use matching CLI/extension builds. Ctrl-C cancels; failed full-page captures save
no partial image. A `loading_stalled` error means the bottom kept a loading
indicator without height growth for 30s; do not simply increase the deadline.
Choose `current` only when that range satisfies the request. A `user_cancelled`
error means user input stopped capture. For other failures follow the returned
reason and hint; do not work around them by editing the page or stitching screenshots.

For `@eN canvas [visual:screenshot]`, observe returns text, not pixels. Screenshot
that ref when its contents matter; never infer Canvas controls or names from
nearby labels. If images cannot be received/understood, explain the limitation,
ask for an image-capable model when needed, and continue with available semantics.

To click a point seen in a Canvas image, retain that screenshot's `capture_id`:

```sh
bsk click @e3 --capture <capture-id> --image-x <x> --image-y <y> --session <id>
```

Use ORIGINAL PNG coordinates and dimensions, not resized display/viewport pixels.
Captures are single-use, expire after 2m, and are invalidated by ref replacement
(observe/snapshot/continuation) or a newer screenshot of that ref. With
`capture_unavailable`, the image is view-only: observe and screenshot again before
clicking. Counts 1/2, buttons and modifiers work; Canvas fill, IME, drag, hover
and HTML extraction do not. Repainting is allowed; changed identity/geometry/hit
targets are rejected. Verify the result, using DOM refs for revealed controls;
inspect `effect_state=unknown` before retrying with a new capture.

## Files and other tools

```sh
bsk upload @e3 --file ./report.pdf --session <id>
bsk download @e3 --out ./report.pdf --session <id>
```

Upload discloses the file to the site; download accepts site-controlled bytes.
Use agent-local paths, not browser-internal staging paths.

- Default upload clicks an upload button/label and intercepts its file chooser.
- If `reason=file_input_not_activated` and `effect_state=none`, re-observe. Try
  `--mode drop` once only on a clear attachment target such as a drop zone or
  composer, never whitespace or an ambiguous container. Otherwise follow the
  human-help rules. There is no automatic fallback between mechanisms.
- Never retry or switch upload modes for `effect_state=unknown` or `committed`.
  A successful drop proves dispatch, not site acceptance; observe the attachment.
- Download refuses overwrite by default; add `--overwrite` only when replacement
  is intended. Consult each command's help for other flags.

Use `console` / `network` for bounded read-only diagnostics; follow returned
sequence cursors. `emulate --device iphone-14` affects one tab; `--off` restores it.
`evaluate` is a last resort: inspect JSON `.ok`, since a script exception can have
CLI exit code 0. Never evaluate secrets. `record start` captures user actions;
read its help first and never record banking, SSO or password-manager pages.
Use `bsk --help` to find navigation/history, tab, wait and window commands.

## Fork additions

These commands and variables exist in this fork (`916938/zenx-bridge`) but not upstream.

### Generic passthrough — `bsk invoke`

`bsk invoke --action <name>` sends a raw JSON params object to any `tool.*` RPC, bypassing the typed
subcommand layer. It is the backend for shell helpers such as `invoke.sh` / `invoke.ps1`.

| Flag | Purpose |
|------|---------|
| `--action <name>` | Tool action: `fill`, `snapshot`, or qualified `tool.fill` |
| `--session <id>` | Session id (merged into params as `session_id`) |
| `--timeout <dur>` | Hard timeout: `30s`, `1m`, `500ms`, or bare ms (default `30s`) |
| `--args-json '{...}'` | Raw JSON arguments (mutually exclusive with `--args-file`) |
| `--args-file <path>` | JSON file path, or `-` for stdin |
| `--dry-run` | Validate and print the request without contacting the daemon |

### Quit a browser — `bsk browsers close`

`bsk browsers` lists connected instances; `bsk browsers close --browser-id <instance_id> --confirm`
stops every session of that instance and then closes all of its windows, which makes the browser
process exit.

| Flag | Purpose |
|------|---------|
| `--browser-id <id>` | Exact `instance_id` from `bsk browsers`; labels and prefixes are rejected |
| `--confirm` | Required acknowledgement (the command refuses to run without it) |

Rules:

- This is the only command that reaches outside a session. It closes **every** window of that
  browser instance, including windows the agent never touched, and discards anything unsaved in
  them. Do not use it to "clean up" — use `bsk session stop <id>` for that.
- Only close an instance the user asked to close, and only after the work on it is done. Never
  guess the id: read `bsk browsers` first.
- A reply may never arrive because the browser exits mid-call. The daemon reports success when the
  instance has actually left the registry (`disconnected: true` in `--json` output); otherwise it
  fails with a timeout, which means the browser is still running.
- `bsk` never starts browsers, so there is no matching "open" command.

### Profile account id — opt-in (fork addition)

`bsk browsers` prints an `ACCOUNT` column: the **obfuscated** account id of the browser profile's
signed-in account, so several connected profiles can be told apart without guessing.

- It is **off by default**. While off the extension never calls `chrome.identity` and never sends
  an account id. Enable it per profile in the extension popup ("Share profile account id"); the
  connection is re-established so the next handshake carries the value.
- Only the opaque id is ever reported — **never an email address**, and never cookies, tokens, or
  storage. Treat it as a routing hint, not as identity data to log or export.
- Empty (`-`) means the profile is not signed in or the user has not opted in. Do not treat an
  empty value as a failure, and do not use the id to select a browser — `--browser-id
  <instance_id>` remains the only exact routing key.

### Profile templates — `bsk templates`

Profile Templates provide template metadata/CRUD and controlled apply responses. They do not
automatically capture a live Profile's cookies or storage — never describe them as an account
backup or migration mechanism.

| Command | Summary |
|---------|---------|
| `bsk templates list` | Summaries (id, name, cookie/storage counts, UA flag, updated time) |
| `bsk templates get <id>` | Full metadata and stored entries |
| `bsk templates create` / `update` | `--name`, `--description`, `--user-agent` (empty clears it) |
| `bsk templates delete <id>` | Delete by id; confirm the id first |
| `bsk templates apply <id>` | Apply to the current Profile; `--scope all\|cookies\|storage\|user-agent` |

Rules:

- `apply` returns the template and application counts; CLI output alone does not prove the browser
  state changed. Observe the target page and verify only the requested non-sensitive result.
- Prefer a narrow `--scope` over `all`. Treat `cookies` and `storage` as sensitive account state.
- Never create, print, or apply templates containing credentials, session tokens, password-manager,
  payment, or unrelated personal data.
- Do not use templates to merge accounts, bypass login, or copy one account's auth state into
  another. Prefer a fresh isolated Profile and normal user authentication.

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BSK_DEFAULT_SESSION` | Session id used when `--session` is omitted | _(none)_ |
| `BSK_INVOKE_TIMEOUT_MS` | Default `invoke` timeout in milliseconds | `30000` |
| `BSK_AUTO_UPDATE` | Set `off` to disable the daemon's automatic `bsk` upgrade | on |

### Global flags

| Flag | Purpose |
|------|---------|
| `--json` | Machine-readable JSON on stdout (errors too) |
| `--quiet` | Suppress informational stderr |
| `-v` / `-vv` | More verbose logging |

## Recover without wandering

- Stale ref: observe again and retry the intended action once.
- Unknown tab or session: list current tabs/sessions; never guess identifiers.
- Timeout: inspect current page state before deciding whether one longer purposeful wait is useful.
- Fill result unconfirmed (`fill_value_mismatch`): observe the field first; the page may have
  formatted the value. Continue if the visible result satisfies the user's intent. Otherwise correct
  the remaining difference; do not blindly repeat fill or immediately request human help. For other
  fill errors, follow the returned hint and inspect current state before retrying.
- Unsupported command: continue with available capabilities; suggest updating only when the missing
  command is necessary.
- Unrecoverable failure: report the blocker and stop the session in a finally-style path.

The CLI's current help and error hints are authoritative for flags, parameters, and recovery
details.

## Exit codes

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | Success (including `evaluate` where JS threw but the RPC succeeded) | Continue |
| `1` | User error — bad args, unknown session, stale ref | Fix args; `bsk session list`; re-observe |
| `2` | Protocol / transport — service unreachable, IPC failure | `bsk doctor`; check the extension; retry once |
| `3` | Browser / CDP execution failed | Retry; simplify the target; check the tab is open |
| `4` | Timeout | Raise `--timeout` and retry |
| `5` | Version skew (CLI vs extension) | Upgrade to matching versions |

Human errors print `error:` + `hint:` on stderr; `--json` includes `code`, `message`, `hint`,
`exit_code`.

## Red lines

1. **No token theft** — never `evaluate` on credential surfaces to read storage, cookies, or auth data.
2. **No long borrow** — return user tabs with `bsk tab return` as soon as the step is done.
3. **No skip stop** — always `bsk session stop <id>`; never rely on the idle timeout.
4. **No post-success control** — stop once the goal is met unless the user asked to keep the session open.
5. **No raw escalation** — observe first; use `get-html` / `screenshot` only when observation cannot answer.
6. **No ambiguous instance targeting** — smart labels are aliases, not isolation or authorization controls; use the full `instance_id` when a label is ambiguous.

---

**More detail for any command:** `bsk <cmd> --help`
