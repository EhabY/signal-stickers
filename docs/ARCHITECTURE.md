# Architecture

The Node engine owns Signal operations. The CLI and local server wrap it; the browser editor talks
to the server over HTTP and WebSocket.

## Packages

| Package           | Responsibility                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| `packages/shared` | Pack shape and edit rules, and image header parsing, for Node and the browser          |
| `packages/core`   | Accounts, crypto, protocol, network clients, pack files, validation, import and upload |
| `packages/cli`    | Arguments, terminal output, and commands over core                                     |
| `packages/server` | Local API, progress events, static assets, and the working copy                        |
| `packages/web`    | Svelte editor, session state, and browser image conversion                             |

`shared` imports nothing from Node, the DOM, or the repo; its typecheck has neither Node nor DOM
types. `core` imports only `shared`, re-exports it, and has no server, DOM, or argument-parsing
code. Operations accept `AbortSignal` and report progress through callbacks. The web app imports
`shared` and the server's types; [server/api.ts](../packages/server/src/api.ts) defines its API
contract.

libsignal is a native Node addon, loaded lazily so importing a pack does not load it. Keep runtime
imports behind the account loaders. This boundary also allows a future Electron wrapper to reuse the
engine.

## Data flows

- **Import:** download and decrypt the manifest and images, then write the pack folder. Writes are
  exclusive; failures wait for active work before cleaning up files they created.
- **Link:** provision this tool as its own device through a phone QR scan, register its keys, and
  save credentials in the tool's config directory.
- **Publish:** validate the folder, encrypt it under a fresh pack key, request upload forms, upload
  the manifest and images, and return a new share link. Errors block publishing; warnings do not.

Protocol details and upstream references belong in [Signal compatibility](SIGNAL_COMPAT.md).

## State and concurrency

The server owns one working copy. Mutations run in a queue; imports stage a new folder and swap it
in on success. Long operations are exclusive and cancel when the client disconnects. Image routes
serve only files named by the pack.

Each working copy has one server. A running server records its URL in the config directory's
`servers/` folder, and starting another for the same pack opens that one instead. A server that
opened the browser stops ten seconds after its last events WebSocket closes, so a reload survives.

The browser's `PackSession` shows edits immediately and serializes saves and image changes.
Responses merge with edits made while requests were pending. Importing another pack invalidates old
results. Animation conversions run in workers while editing continues; stale conversions are
canceled. Publishing waits for conversions, pending image changes, and imports to finish.

## Security

The server binds to `127.0.0.1`, validates Host and Origin headers, and forbids framing. It has no
remote authentication and is intended for local use.

Signal requests use the pinned Signal CA. Credentials stay in the tool's own config directory with
owner-only permissions; account status excludes the password. Production is the default, and
credentials retain their environment. See [AGENTS.md](../AGENTS.md) for required guardrails.

## Code organization

Core modules are grouped under `account/`, `net/`, `protocol/`, `stickers/`, and `util/`. The server
separates routing from working-copy operations; web components live in `components/` and state and
conversion code in `lib/`.

Use camelCase filenames, explicit `.ts` imports, and `<module>.test.ts` files under each package's
`test/`. Shared core fixtures are exported as `@signal-stickers/core/testing`; runtime code must
never import them. Public core exports need unique names because `index.ts` uses star exports.
