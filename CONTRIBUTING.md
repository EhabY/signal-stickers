# Contributing

Use Node.js 24+ and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm dev
```

The editor runs at http://localhost:5173, with the API on port 5174.

## Commands

| Command                             | Purpose                              |
| ----------------------------------- | ------------------------------------ |
| `pnpm build` / `pnpm watch`         | Build the CLI and web app            |
| `pnpm typecheck`                    | Check TypeScript and Svelte          |
| `pnpm lint` / `pnpm lint:fix`       | Type-aware linting                   |
| `pnpm format:check` / `pnpm format` | Check or apply formatting            |
| `pnpm test` / `pnpm test:coverage`  | Tests and coverage                   |
| `pnpm clean`                        | Remove dependencies and build output |

Run typecheck, lint, format check, and affected tests before submitting. CI also builds on Linux and
tests on Linux, Windows, and macOS. See [Testing](docs/TESTING.md) for fixtures and manual checks.

## Changes

Keep changes focused and follow [AGENTS.md](AGENTS.md). Put reusable operations in `core`; CLI,
server, and web code should respect the [package boundaries](docs/ARCHITECTURE.md).

Use Conventional Commit titles: `type(scope): message`. Scopes are `shared`, `core`, `cli`,
`server`, `web`, `repo`, and `docs`. PR titles follow the same convention and become squash-merge
commits.

For user-facing `feat`, `fix`, `perf`, or `security` changes, generate the changelog entry in the
same change:

```sh
pnpm changelog --with-commit "<commit or PR title>"
```

Do not edit `CHANGELOG.md` by hand. Crypto changes need a round-trip or known-answer test. Update
[Signal compatibility](docs/SIGNAL_COMPAT.md) when adding or changing a Signal dependency.

## Toolchain

- Dependency versions live in the `pnpm-workspace.yaml` catalog. Keep libsignal pinned to the
  version used by Signal Desktop. Discuss new runtime dependencies before adding them.
- Source runs with Node's type stripping. Use erasable TypeScript, ES modules, and explicit `.ts`
  imports. TypeScript 7 checks types; the TypeScript 6 alias supports Svelte's transpiler.
- Oxlint and Oxfmt enforce linting and formatting. Their configs are authoritative; changing lint
  rules requires approval.
- The CLI bundles with esbuild and keeps libsignal external. The server runs from source; Vite
  builds the web app into `packages/web/dist`.

## Releases

Run the **Release** workflow on `main`, optionally specifying a version. It determines the version
from commits, updates manifests and the changelog, tests, builds, and pushes the release commit and
tag. While on 0.x, features and breaking changes bump the minor version; other changes bump patch.

The GitHub release contains the CLI bundle and a build provenance attestation:

```sh
gh attestation verify signal-stickers.mjs --repo EhabY/signal-stickers
```

Branch protection must permit the release workflow to push to `main`.
