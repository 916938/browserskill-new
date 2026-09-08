---
name: browser-skill
description: |
  Use when the user asks to automate their logged-in Chromium browser: visit
  and read pages, fill forms, scrape data, click through flows, regression-test
  a PR's UI, validate a deployed page, operate a tab they identify, or target a
  connected browser instance by smart label or instance id. Requires the bsk
  CLI and browser extension.
---

# browser-skill

Drive the user's real Chromium browser through `bsk`. Automation runs in an isolated **Agent
Window** with the user's existing logins and cookies. User-window tabs remain protected unless they
are explicitly borrowed.

Do not use this skill for tasks with no browser, for extension installation, or when the user only
wants instructions. Never extract credentials, cookies, tokens, or other secrets from pages.

## Required lifecycle

Every browser task owns a bounded session:

```text
1. bsk session start              # retain the printed 4-letter session id
2. bsk ... --session <id>         # pass it to every session-scoped command
3. bsk session stop <id>          # always run on success and error paths
```

Do not rely on the idle timeout for cleanup. Stop the session as soon as the goal is met unless the
user explicitly asks to keep it open. Stopping also returns borrowed tabs.

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

An observation marks a hover-only surface as `@e1 button "Products" [hover first: Shoes | Bags]`.
The listed items are labels, not usable refs: hover the trigger, observe again, then act on the
revealed item's own ref. Do not click the trigger itself unless the user wants the trigger's action.
`[has-submenu]` and `[expanded]` mark the same kind of trigger without listing what it hides.

`bsk observe` does not hover the page on its own. Reach for `--probe-hover` when a control you have
good reason to expect is absent **and** no marker points at a trigger — that combination is what a
CSS-only hover menu looks like from here. It hovers a bounded set of likely triggers, so it costs a
few seconds and touches the live page; once you know which element hides the menu, `bsk hover <ref>`
is cheaper and more precise.

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
session start|stop|list   browsers   status   doctor   update   logs
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

`select` matches an option's `value` attribute, not its visible label. Device preset ids are
lowercase and hyphenated, such as `iphone-14`.

- `console` and `network` provide bounded, read-only debugging evidence.
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

## File transfer

`upload` and `download` stage files through the daemon; the agent never touches browser-internal
paths. Treat upload as disclosure to the website, download as accepting website-controlled bytes.

Upload has two independent mechanisms — choose explicitly, never rely on automatic fallback:

- **Default (input mode):** for upload buttons, file-input labels, or "upload from computer"
  actions. The command clicks the target and intercepts the native file chooser.
- **`--mode drop`:** for reliably identified attachment-receiving areas — an explicit drop zone,
  chat composer, email editor, or form attachment area. Do not target page whitespace, generic
  containers, or areas whose attachment ownership is ambiguous.

Decision sequence when uploading:

1. Try input mode (the default).
2. If it returns `reason=file_input_not_activated` with `effect_state=none`, re-observe. When a
   reliable attachment target exists, try `--mode drop` once against that target.
3. Otherwise fall back to `request-help`.
4. **Never** switch mechanisms or repeat when `effect_state` is `unknown` or `committed` — the
   browser may already have applied the file.

A successful drop means Chrome dispatched the native file-drop event; it does not prove the site
accepted the attachment. Observe the page once after the command.

Download default-refuses to overwrite; pass `--overwrite` when replacing an existing file is
intended. Read `bsk upload --help` and `bsk download --help` for all flags and error details.

## Fork additions

These commands and variables exist in this fork (`916938/browserskill-new`) but not upstream.

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
