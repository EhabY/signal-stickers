# Contributing

## Setup

```sh
corepack enable pnpm
pnpm install
```

## Everyday commands

| Command                                             | What it does                              |
| --------------------------------------------------- | ----------------------------------------- |
| `pnpm build` / `pnpm watch`                         | Build the CLI bundle and the web app      |
| `pnpm dev`                                          | Run the web app's dev server              |
| `pnpm pull <link> [dir]` / `pnpm push [dir]`        | Run the CLI from source                   |
| `pnpm run link` / `pnpm status` / `pnpm run unlink` | Link, inspect, or unlink the CLI's device |
| `pnpm test` / `pnpm test:coverage`                  | Run all tests, optionally with coverage   |
| `pnpm typecheck`                                    | TypeScript 7 and svelte-check             |
| `pnpm lint` / `pnpm lint:fix`                       | Oxlint, type-aware                        |
| `pnpm format` / `pnpm format:check`                 | Oxfmt                                     |
| `pnpm changelog`                                    | Regenerate `CHANGELOG.md` from commits    |
| `pnpm clean`                                        | Remove `node_modules` and build output    |

`pnpm link` and `pnpm unlink` are pnpm built-ins, so those two need `pnpm run`.

Run typecheck, lint, format check, and the affected tests before opening a pull request.

## Pull requests

- One purpose per pull request.
- Titles follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): message`,
  with scopes `core`, `cli`, `server`, `web`, `repo`, or `docs`. CI checks the title, and the
  squash-merged title becomes the commit.
- `CHANGELOG.md` is generated from commit titles, so give user-facing `feat`, `fix`, `perf`, and
  `security` changes a title users will understand, and include the regenerated changelog in the
  same pull request: `pnpm changelog --with-commit "<pull request title>"`.
- Changes to crypto or Signal protocol code need a round-trip or known-answer test and a note in
  [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md) if they depend on something new from Signal.

CI runs typecheck, format check, lint, and build on Linux, and the tests on Linux, Windows, and
macOS.

See [AGENTS.md](AGENTS.md) for code style and project guardrails, and [docs/](docs) for
architecture, structure, testing, and tooling.

## Releasing

Run the **Release** workflow from the Actions tab on `main`. It:

1. Picks the next version from the commits since the last tag with git-cliff (or uses the version
   you enter): `feat` and breaking changes bump the minor version while on 0.x, everything else the
   patch.
2. Updates every `package.json` and `CHANGELOG.md`, runs the tests, builds, commits
   `chore(release): vX.Y.Z`, and pushes the commit and tag.
3. Publishes a GitHub release with the notes and `signal-stickers.mjs`, plus a signed build
   provenance attestation
   (`gh attestation verify signal-stickers.mjs --repo EhabY/signal-stickers`).

If `main` gets branch protection, allow GitHub Actions to push to it, or the commit step fails.
