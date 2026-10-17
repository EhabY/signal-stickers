# Code Structure

```
packages/
  core/     engine; depends on nothing in the repo
    src/
      env.ts            production/staging hosts
      net/              pinned-CA HTTPS client, CDN client, Signal CA
      protocol/         hand-rolled protobuf reader/writer and message codecs
      stickers/         links, pack crypto, image sniffing, pack.json, pull
      util/             small generic helpers
    test/               mirrors src/; test/support is the shared test kit
  cli/      signal-stickers command; src/cli.ts is testable, src/main.ts wires the process
  server/   local HTTP + WebSocket API (placeholder)
  web/      Vite + Svelte UI (placeholder)
scripts/    repo scripts, run directly with Node
docs/       these guides
```

## Where code goes

- Signal protocol and crypto belong in `core`. If cli or server needs logic, move it into core and
  export it from `core/src/index.ts`.
- One module per concern. Error classes live in the module that throws them.
- `core` must not import other workspace packages, and `web` may only import types from `core`.
  Oxlint enforces both.

## Conventions

- Files are camelCase (`signalCa.ts`); tests are `<module>.test.ts` under `test/`, mirroring `src/`.
- Order each file like a newspaper: exported API first, then private helpers in order of use.
- Relative imports include the `.ts` extension so Node can run the source directly.
- Shared test helpers live in `packages/core/test/support` and are exported as
  `@signal-stickers/core/testing` for other packages' tests. Runtime code must not import it.
