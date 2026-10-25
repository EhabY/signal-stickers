# signal-stickers: Development Guidelines

A standalone tool to import, edit, and re-upload Signal sticker packs: a Node engine
(`packages/core`) wrapped by a CLI (`packages/cli`), a local HTTP+WS server (`packages/server`), and
a Vite + Svelte web UI (`packages/web`), with code both core and web run in `packages/shared`. It
links itself as its own Signal device; it never reads Signal Desktop's data.

> Implementation details live in the guides below, with Signal dependencies and verification dates
> in [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md).

Make the smallest correct change, follow existing patterns, and verify the result. Prefer simple,
readable solutions over clever ones; doing it right beats doing it fast. We're colleagues:
prioritize correctness over agreement, push back on bad ideas with evidence, and state uncertainty
instead of guessing.

## Autonomy

- Resolve routine ambiguity from the code, tests, docs, and git history. Make reasonable, reversible
  assumptions that match existing patterns, state the consequential ones, and keep going.
- Ask only when the answer can't be recovered and would change the result, or before a destructive
  or irreversible action (e.g. anything that hits Signal's **production** servers, links/unlinks a
  device, or uploads a pack).
- Discuss architectural decisions first: new packages, new dependencies (especially native ones), or
  patterns that cross packages. Routine fixes need no discussion.
- Requests to implement, fix, or investigate authorize that work even when phrased as a question.
  Answer informational questions directly.

## Guides

Read only what the task needs:

- Package boundaries, code organization, and data flows:
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tests, the fake chat/CDN, the manual QR step: [docs/TESTING.md](docs/TESTING.md)
- Development commands, tooling, PRs, and releases: [CONTRIBUTING.md](CONTRIBUTING.md)
- Every Signal-side dependency (crypto, endpoints, protobufs), its Signal-Desktop reference, and
  what to check when Signal changes something: [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md).
  Update it when you add one.

## Commands

- Build: `pnpm build`, `pnpm watch`, and with Node.js 26 this platform's app:
  `pnpm --filter server build:executable`
- Run: `pnpm dev` (server and web, at http://localhost:5173), `pnpm start` (build web, then serve
  it), and the CLI with `pnpm pull`, `pnpm push`, `pnpm run link`, `pnpm status`, `pnpm run unlink`
  (`pnpm link` and `pnpm unlink` are pnpm built-ins)
- Release: the Release workflow on GitHub (see CONTRIBUTING.md); `pnpm changelog` to regenerate
- Check: `pnpm typecheck`, `pnpm lint` (`lint:fix`), `pnpm format:check` (`format`)
- Tests: `pnpm test`, or a package filter (e.g. `pnpm --filter core test`) with an optional file
  path
- Clean: `pnpm clean`

Run targeted tests while iterating. Before handoff run typecheck, lint, format check, and the
affected tests.

## Guardrails (project-specific: do not violate)

- **Never read Signal Desktop's data** or any other application's credential store (no SQLCipher DB,
  no Electron `safeStorage`, no OS keychain scraping). The tool provisions **its own** linked device
  and stores credentials in its own config dir only.
- **Never weaken TLS.** All chat/CDN requests use the pinned Signal CA
  (`packages/core/src/net/signalCa.ts`). Never set `rejectUnauthorized: false`, never touch
  `NODE_TLS_REJECT_UNAUTHORIZED`.
- **Crypto is ported, not invented.** Match the Signal-Desktop logic referenced in
  [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md) exactly: HKDF salts/info strings, AES/HMAC layout,
  key sizes, protobuf field numbers. Add a round-trip or known-answer test for every crypto change.
- **Keep secrets out of logs:** the account password, identity/prekeys, pack keys, and the
  provisioning code are never logged. Redact pack ids as Signal does.
- **`core` stays transport- and UI-agnostic:** no HTTP server, no DOM, no `process.argv` parsing.
  CLI, server, and a future Electron app all reuse it.
- **Default to production, staging opt-in.** Never silently point uploads or linking at the wrong
  environment; the chosen env is explicit and surfaced.
- **Credentials file is a secret:** write it owner-only (`0600` / owner ACL); warn the user.
- **Minimal dependencies.** A new runtime dependency, especially a native one, is an architectural
  decision to discuss first.

## Code style

- Strict TypeScript: no `any`, no `as unknown as`, no non-null assertions outside tests. Prefer
  annotations and narrowing over `as`; fix types at the source.
- **Erasable syntax only** (no `enum`, no `namespace`, no parameter properties), so source runs
  under Node type-stripping and `tsgo` and bundles with esbuild. Use `const` objects + union types
  instead of enums.
- ES modules, `const` over `let`, async/await over explicit Promises, `_`-prefixed unused variables,
  wrapped and typed errors.
- Operations are async and cancelable (`AbortSignal`); progress is reported via callbacks/events,
  never `console.log` inside `core`.
- YAGNI. Search for existing code before writing new code, reduce duplication, delete dead code.
  Match the surrounding style; fix bugs when you find them.
- Names say what code does, not how or its history. Abbreviate only when obvious.
- Comment as little as possible. Add one only when the code needs explaining (a non-obvious
  invariant, external constraint, or tradeoff), and keep it to a line or two. Never restate the
  code. Re-read every comment your diff adds and delete what isn't needed. No em dashes or spaced
  double hyphens as punctuation in code, comments, or docs.
- JSDoc exported functions and types whose contract isn't obvious.
- Order a file like a newspaper: exported API first, then private helpers in the order they are
  first used.
- Tests read linearly: arrange, act, assert, top to bottom. Share setup through small reusable
  helpers and fixtures (e.g. a fake CDN, a pack builder) instead of repeating it or hiding it in
  deep `beforeEach` chains. Keep suites short; one behavior per test.
- Keep each change to one purpose; don't touch unrelated code.

## Version control

- Commit often. Titles use Conventional Commits (`type(scope): message`), imperative, around 70
  characters. Scopes map to packages: `shared`, `core`, `cli`, `server`, `web`, plus `repo`/`docs`.
- Never skip hooks. Check `git status` before `git add`. Never force push unless asked.
- Never add `Co-Authored-By` trailers to commits.
- `CHANGELOG.md` is generated from commits; never edit it by hand. User-facing changes use `feat`,
  `fix`, `perf`, or `security` (`!` if breaking) with a title written for users, and the same commit
  includes its changelog entry: `pnpm changelog --with-commit "<commit title>"`. Other types are
  left out.
- Never disable a lint rule without user approval.

Read `AGENTS.local.md` when present; it is gitignored, for personal instructions.
