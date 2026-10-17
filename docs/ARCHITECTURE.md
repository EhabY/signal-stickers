# Architecture

signal-stickers imports, edits, and re-uploads Signal sticker packs without Signal Desktop. It links
itself as its own Signal device and never reads another app's data.

## Constraint: the engine runs in Node

`@signalapp/libsignal-client` is a native Node addon, so device linking and Signal crypto must run
in a Node process. Everything else follows from that:

```
cli ──┐
      ├──► core (Node: crypto, chat service, CDN, pack folders, linking, upload)
server┘        ▲
  ▲            │ imported directly
  │ HTTP + WS
 web (browser UI, talks only to server)
```

- **core** is the engine. It has no HTTP server, DOM, or argv parsing, and reports progress through
  callbacks and `AbortSignal`s, so any front end can drive it.
- **cli** and **server** are thin front ends over core.
- **web** is a Vite + Svelte app served by server. It never imports core or server at runtime; it
  shares only the API types in `server/src/api.ts`.

An Electron app can later import core in its main process, or spawn server, and load web as the
renderer without changing these packages.

core loads libsignal only through dynamic `import()` (`account/libsignal.ts`), so `pull` never loads
the native addon. Keep static imports from libsignal type-only: esbuild hoists static imports of
external packages to the top of the CLI bundle.

## Pull

Pulling needs no account.

1. Parse the `signal.art` link into a pack id and key (`stickers/link.ts`).
2. Derive the AES and MAC keys from the pack key (`stickers/crypto.ts`).
3. Download and decrypt `manifest.proto` from the CDN, then decode it (`protocol/protobuf.ts`).
4. Download and decrypt each sticker, three at a time, plus a separate cover if the manifest names
   one outside the sticker list (`stickers/pull.ts`).
5. Write `001.png`, `002.webp`, …, an optional `cover.*`, and `pack.json` (`stickers/pack.ts`).
   Nothing is written until every image has downloaded, and the first failed download cancels the
   others. Files are created exclusively, so nothing that appears in the folder meanwhile is
   overwritten, and a failed write removes what was written.

All requests use Signal's pinned CA (`net/signalCa.ts`); the default root store is not trusted.

## Link

`linkDevice` (`account/link.ts`) provisions this tool as a new device named `signal-stickers`:

1. `waitForScan` (`account/scan.ts`) opens a provisioning socket through libsignal
   (`account/provisioningTransport.ts`) and reports a QR URL with the socket's address and a fresh
   public key. Like Signal Desktop it shows a new code every 45 s while the previous one stays
   scannable, and gives up after six.
2. The phone sends an encrypted `ProvisionMessage`; `account/provisioningCipher.ts` decrypts it into
   the account's identity keys, aci, pni, number, and provisioning code.
3. `registerDevice` (`account/register.ts`) generates a registration id, password, and signed
   prekeys (`account/keys.ts`), encrypts the device name (`account/deviceName.ts`), and sends
   `PUT /v1/devices/link`.
4. The front end saves the returned credentials with a `CredentialsStore`.

Progress (`connecting`, `waitingForScan` with the QR URL, `registering`, `done`) carries no secrets,
so front ends forward it as is. `unlinkDevice` sends `DELETE /v1/devices/{id}`; the front end then
deletes the credentials.

Chat requests go through `net/chat.ts`: JSON over the pinned CA with Basic auth, where the username
is `aci.deviceId` (`getChatAuth`).

## Credentials

`createCredentialsStore` (`account/credentials.ts`) keeps one account in `credentials.json` in the
tool's own config directory (`%APPDATA%\signal-stickers`, `~/Library/Application Support/...`, or
`$XDG_CONFIG_HOME/signal-stickers`). The file is written to a temporary file and renamed, and is
owner-only: mode `0600` on POSIX, and an `icacls` ACL granting only the current user on Windows.
Front ends show `credentialsWarning(path)` after linking. The password never leaves core: status
goes through `getLinkStatus`, which drops it.

## Push

`pushPack` (`stickers/push.ts`) uploads a pack folder as a new pack:

1. Read `pack.json` and its images (`stickers/validateFolder.ts`) and check them against Signal's
   limits (`stickers/validate.ts`). Any issue throws a `PackValidationError` listing all of them,
   before any request.
2. Build and encrypt the manifest and images under a fresh pack key (`stickers/encryptPack.ts`). The
   cover reuses a sticker's id when it is the same image, as Signal's sticker creator does.
3. Ask the chat service for upload forms: `GET /v1/sticker/pack/form/{count}`.
4. Upload the manifest, then the images three at a time, to the CDN as S3 multipart forms
   (`net/cdn.ts`), reporting `{ done, total }` after each.
5. Return the new pack's `signal.art` link.

## Server

`startServer` (`server/src/server.ts`) serves the API, one WebSocket for progress events, and the
built web app. It has no login, so it guards the user's account by:

- listening on `127.0.0.1` only;
- rejecting any `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, which stops DNS
  rebinding;
- rejecting any `Origin` other than its own (or one passed with `--allow-origin`), which stops other
  sites' pages, on every request and WebSocket upgrade;
- forbidding other sites to frame its pages, where they could trick the user into clicking.

Routes (`server/src/routes.ts`) are typed against `ApiRoutes` in `server/src/api.ts`, the contract
with web. Link, unlink, pull, and push run one at a time (409 otherwise), and abort when the client
disconnects. Their progress goes out as WebSocket events while the request stays open.

The server edits one working copy, `./pack` by default (`server/src/workingCopy.ts`). Edits are
queued one at a time. A pull writes into a sibling folder and swaps it in, so a failed pull keeps
the old copy. Image routes only serve files that `pack.json` names, and added images get
server-chosen names.

## Web

The browser app talks to the server through a typed `fetch` client (`web/src/lib/api.ts`) and one
WebSocket (`lib/events.svelte.ts`). `PackSession` (`lib/packSession.svelte.ts`) holds the pack being
edited, shows edits at once, and saves them shortly after, in order. Every save returns the pack's
validation issues, so the editor shows them live without duplicating Signal's rules. Added images
are converted in the browser with a `<canvas>` (`lib/stickerImage.ts`): PNG and WebP images that
already fit are kept as they are, so animations survive; anything else becomes a 512x512 WebP within
the size limit. The app talks to nothing but the local server: the emoji picker's data
(`emoji-picker-element-data`) is bundled by Vite as an asset.

## Environments

Production is the default. Staging is opt-in with `--staging` or `SIGNAL_STICKERS_ENV=staging`, and
the CLI and server print which one they use. Saved credentials remember their environment: unlinking
always uses it, and pushing refuses credentials from the other environment.

Signal-side details that could change are tracked in [SIGNAL_COMPAT.md](SIGNAL_COMPAT.md).
