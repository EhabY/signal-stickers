# Architecture

signal-stickers imports, edits, and re-uploads Signal sticker packs without Signal Desktop. It links
itself as its own Signal device and never reads another app's data.

## Constraint: the engine runs in Node

`@signalapp/libsignal-client` is a native Node addon, so device linking and Signal crypto must run
in a Node process. Everything else follows from that:

```
cli ──┐
      ├──► core (Node: crypto, CDN, pack folders, later linking and upload)
server┘        ▲
  ▲            │ imported directly
  │ HTTP + WS
 web (browser UI, talks only to server)
```

- **core** is the engine. It has no HTTP server, DOM, or argv parsing, and reports progress through
  callbacks and `AbortSignal`s, so any front end can drive it.
- **cli** and **server** are thin front ends over core.
- **web** is a Vite + Svelte app served by server. It never imports core at runtime.

An Electron app can later import core in its main process, or spawn server, and load web as the
renderer without changing these packages.

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

## Environments

Production is the default. Staging is opt-in with `--staging` or `SIGNAL_STICKERS_ENV=staging`, and
the CLI always prints which one it uses.

## Planned

Device linking, `push`, the server, and the web editor come next. Signal-side details that could
change are tracked in [SIGNAL_COMPAT.md](SIGNAL_COMPAT.md).
