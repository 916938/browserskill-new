# AGENTS.md

## What is this

BrowserSkill connects AI agents to a user's real Chromium browser via a local `bsk` CLI + daemon + browser extension. The repo is a **dual workspace**: Cargo (Rust) + pnpm (JS/TS).

## Structure

| Path | What it is |
|------|------------|
| `crates/bsk-cli` | `bsk` CLI binary and local daemon (Rust). Published crate name: `bsk`. |
| `crates/bsk-protocol` | Shared wire types, JSON-RPC frames, JSON schemas. `dump-schema` binary auto-generates `crates/bsk-protocol/schema/`. |
| `apps/extension` | Chromium extension (WXT + React + Tailwind v4). MV3, talks to daemon over WebSocket on `ws://127.0.0.1:52800`. |
| `packages/ui` | Shared extension UI components (shadcn-style, tailwind-merge + CVA). Consumed via source imports, not built. |
| `packages/i18n` | i18next-based i18n. Also consumed via source imports. |
| `skill/SKILL.md` | The agent skill file — copied into `crates/bsk-cli/skill/` by `build.rs` at cargo build time. Edit only the root copy. |
| `scripts/` | Node scripts for release artifacts (e.g. `render-version-json.mjs`). Tests use `node:test`. |

## Commands

### Full CI-equivalent check (what passes in CI)

**Rust:**
```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

**Frontend:**
```bash
pnpm install --frozen-lockfile
pnpm --filter @browser-skill/extension exec wxt prepare   # generates .wxt/ types — required before compile/test
pnpm lint                                                  # biome check + stylelint
pnpm --filter @browser-skill/extension compile             # tsc --noEmit
pnpm ext:test                                              # vitest run (extension only)
pnpm ext:build                                             # wxt build
```

**Node scripts:**
```bash
node --test scripts/*.test.mjs
```

### Quick iteration

```bash
# Rust: build the CLI only (skips schema dump since it's already generated)
cargo build -p bsk

# Extension dev server (hot reload)
pnpm ext:dev

# Extension tests only
pnpm ext:test

# Lint only
pnpm lint
```

### Schema regeneration

The `cli:build` script regenerates protocol schemas then builds JS:
```bash
pnpm cli:build   # runs: cargo run -p bsk-protocol --bin dump-schema --locked && pnpm -r build
```

Schemas land in `crates/bsk-protocol/schema/`. These are committed and should match what `dump-schema` produces.

## Important quirks

- **`wxt prepare` is required** before `tsc --noEmit` or `vitest` — it generates `.wxt/` type stubs. CI always runs it; you must too.
- **`--locked` on cargo commands** — the CI enforces lockfile integrity. Always pass `--locked` to `cargo build`, `cargo test`, `cargo clippy`, etc.
- **pnpm 10.17.0** — pinned in `packageManager` field. Do not upgrade without updating the lockfile.
- **Cargo edition 2024, rust-version 1.85** — edition 2024 is new; some patterns differ from 2021 (e.g. `gen` keyword reserved, `unsafe_op_in_unsafe_fn` warn-by-default). Rust stable toolchain with `rustfmt` + `clippy` components.
- **Biome formatter only, linter disabled** — `biome.json` has `"linter": { "enabled": false }`. Formatting is enforced; linting is not.
- **Stylelint for CSS** — uses `stylelint-config-standard`. The `.stylelintrc.json` allows Tailwind directives (`@apply`, `@theme`, `@source`, `@custom-variant`).
- **Extension path aliases** — `@/` and `~/` map to `./src/`. `@browser-skill/i18n` resolves to the local package source, not a built artifact.
- **Version sources are separate** — CLI version lives in `Cargo.toml` workspace version; extension version in `apps/extension/package.json`. Release workflows verify they match the git tag. When bumping, update both independently.
- **Release tags** — CLI releases use `cli-v*` tags; extension releases use `ext-v*` tags.
- **`skill/SKILL.md` is the single source of truth** — the `build.rs` in `bsk-cli` copies it into the crate during cargo build. Do not edit `crates/bsk-cli/skill/SKILL.md` directly.
- **Extension tests use `happy-dom`** (not jsdom). Test files live alongside source as `*.test.ts` / `*.test.tsx`.
- **`AGENT_INSTALL.md`** is an agent-facing install guide. It says "never use sudo" and defines "done = `bsk doctor` passes."

## Style conventions

- Rust: 4-space indent, 100 char max width (`rustfmt.toml`), clippy cognitive complexity threshold 30.
- JS/TS/CSS/MD: 2-space indent, 100 char line width (Biome). Double quotes, always semicolons, trailing commas. JSON: no trailing commas.
- LF line endings everywhere (`.editorconfig`).
- Extensions `.gitignore`d: `target/`, `node_modules/`, `dist/`, `.output/`, `.wxt/`.
