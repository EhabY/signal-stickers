# Tooling

## Node.js and pnpm

- Node.js 24 or newer (`engines`, `@tsconfig/node24`, `@types/node` 24, esbuild `target`). Source
  runs directly under Node's type stripping, including the scripts in `scripts/`.
- pnpm is pinned with a hash in `packageManager`. Update it with `corepack use pnpm@latest`.
- Every dependency version lives in the `catalog` in `pnpm-workspace.yaml` (`catalogMode: strict`).
  pnpm settings such as `engineStrict` live there too; pnpm only reads auth from `.npmrc`. After
  `pnpm update`, run `pnpm dedupe`.

## TypeScript

- `tsc` is TypeScript 7 (`@typescript/native`, aliased to `typescript@7`).
- `typescript` is aliased to `@typescript/typescript6` only because `svelte-check` still needs the
  6.0 API to transpile `.svelte` files. It runs with `--tsgo`, so diagnostics come from
  TypeScript 7. Drop the alias once svelte-check supports TypeScript 7 on its own.
- `tsconfig.base.json` enables `erasableSyntaxOnly`, `verbatimModuleSyntax`, and
  `allowImportingTsExtensions`, so no `enum`, `namespace`, or parameter properties, and relative
  imports end in `.ts`. It keeps `@tsconfig/node24`'s nodenext resolution so anything that
  typechecks also runs under Node; only `packages/web` uses `Bundler` resolution for Vite.

## Linting

Oxlint, type-aware, with whole categories enabled instead of hand-picked rules: `correctness`,
`suspicious`, `pedantic`, and `perf` across the `eslint`, `typescript`, `unicorn`, `oxc`, `import`,
`node`, `promise`, and `vitest` plugins. On top of that, `.oxlintrc.jsonc` only adds the
restrictions AGENTS.md requires (no `console`, `any`, or non-null assertions), the package import
boundaries, `no-import-type-side-effects` (with `verbatimModuleSyntax`, an inline `type` import
still loads the module), and two documented exceptions. One inline `no-await-in-loop` exception in
`mapConcurrent` is intentional. `style` and `restriction` stay off: they contain contradictory and
taste-only rules.

Changing a rule's level needs approval (see AGENTS.md).

## Formatting

Oxfmt formats everything, deterministically: imports are sorted (`sortImports`), objects are laid
out from their content rather than how they were typed (`objectWrap: "collapse"`), and Markdown is
re-wrapped (`proseWrap: "always"`). Otherwise it uses oxfmt's defaults (print width 100, sorted
`package.json`), plus tabs and LF from `.editorconfig`. Oxfmt also skips everything in `.gitignore`.

## Changelog

[git-cliff](https://git-cliff.org) generates `CHANGELOG.md` from Conventional Commits in Keep a
Changelog format (`cliff.toml`). `feat` becomes Added, `perf` Changed, `fix` Fixed, and `security`
Security; other types are left out unless marked breaking. Each user-facing commit carries its own
entry, rendered before the commit exists with `pnpm changelog --with-commit "<title>"`. Releases
come from `v*` tags (see the Release workflow). Oxfmt skips the generated file.

## CI

`.github/workflows/ci.yaml` runs typecheck, format check, lint, and build on Linux, and the tests on
Linux, Windows, and macOS. `pr-title-lint.yaml` enforces Conventional Commit titles with our scopes,
since squash-merged titles feed the changelog. Actions are pinned by commit SHA, and Dependabot
updates them monthly and npm packages weekly. `.github/actions/setup` installs pnpm, Node.js 24, and
dependencies. `release.yaml` cuts releases from `main`; see CONTRIBUTING.md.

## Building

- `packages/cli/scripts/build.ts` bundles the CLI with esbuild to `dist/signal-stickers.mjs`,
  keeping native addons external.
- `packages/web` builds with Vite.
- `scripts/run-tool.ts` runs oxlint and oxfmt with a capped thread count, without the Windows `.bin`
  shims, and prints how long they took.
- `concurrently` runs the root and package typechecks in parallel on every platform.
