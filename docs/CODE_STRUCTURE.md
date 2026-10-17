# Code Structure

```
packages/
  core/     engine; depends on nothing in the repo
    src/
      env.ts            production/staging hosts
      account/          linking: QR scan, provisioning crypto, keys, registration, credentials
      net/              pinned-CA HTTPS client, chat and CDN clients, Signal CA
      protocol/         hand-rolled protobuf reader/writer and message codecs
      stickers/         links, pack crypto, image sniffing, pack.json, validation, pull, push
      util/             small generic helpers
    test/               mirrors src/; test/support is the shared test kit; test/fixtures holds
                        certificates and sample images
  cli/      signal-stickers command
    src/                cli.ts parses arguments and dispatches; pull.ts, push.ts, and account.ts
                        (link, status, unlink) hold the commands; context.ts the injectable
                        services, the parsed command options, and shared output; main.ts wires
                        the process
  server/   local HTTP + WebSocket API and the web app's host
    src/                api.ts (the contract with web), server.ts (listening, Host and Origin
                        checks, events), dispatch.ts and router.ts (typed routing), routes.ts
                        (handlers over core), workingCopy.ts (the pack folder), static.ts,
                        errors.ts, browser.ts, and cli.ts/main.ts like the CLI package
  web/      Vite + Svelte UI
    src/                App.svelte; components/ has one component per screen (ImportView, Editor,
                        PublishView, AccountView) plus their parts; lib/ has the API client,
                        events, the edited pack session, and the image encoder
scripts/    repo scripts, run directly with Node
docs/       these guides
```

## Where code goes

- Signal protocol and crypto belong in `core`. If cli or server needs logic, move it into core and
  export it from `core/src/index.ts`.
- One module per concern. Error classes live in the module that throws them.
- `core` must not import other workspace packages. `web` may only import types from `core` and from
  `@signal-stickers/server/api`; it talks to the server over HTTP and WebSocket. Oxlint enforces
  both.
- The server's `api.ts` is the contract with web: routes keyed by `"METHOD /path"`, their request
  and response types, and the WebSocket events. Change both sides together.
- `core/src/index.ts` re-exports whole modules with `export *`, which silently drops a name that two
  modules export, so exported names must be unique across core. `stickers/validate.ts` stays free of
  Node imports so web could share it later.

## Conventions

- Files are camelCase (`signalCa.ts`); tests are `<module>.test.ts` under `test/`, mirroring `src/`.
- Order each file like a newspaper: exported API first, then private helpers in order of use.
- Relative imports include the `.ts` extension so Node can run the source directly.
- Shared test helpers live in `packages/core/test/support` and are exported as
  `@signal-stickers/core/testing` for other packages' tests. Each other package keeps its own
  helpers in `test/support.ts` (web: `test/support/`). Runtime code must not import them.
