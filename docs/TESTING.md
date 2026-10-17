# Testing

Tests use [Vitest](https://vitest.dev). The root `vitest.config.ts` defines one project per package:
`core`, `cli`, and `server` run in Node, and `web` runs in jsdom. The web project extends
`packages/web/vite.config.ts` for the Svelte plugins, whose `svelteTesting()` switches Svelte to its
browser build and cleans up the DOM between tests.

```sh
pnpm test                                   # everything
pnpm test:coverage                          # with a coverage report
pnpm --filter core test                     # one package
pnpm --filter core test test/stickers/pull  # one file
```

No test talks to Signal.

## Writing tests

- Read top to bottom: arrange, act, assert. One behaviour per test.
- Prefer a small local helper (like `pull()` in `pull.test.ts`) over `beforeEach` chains, and
  `it.each` tables over copy-pasted tests.
- Reuse the kit in `packages/core/test/support` (`@signal-stickers/core/testing`):
  - Pull: `fakeCdn(manifest, { images, failingStickerId })` serves an encrypted pack described by
    `PACK_ID`, `PACK_KEY`, `PACK_LOCATOR`, `PACK_LINK`, and `PACK_KEYS`, and records sticker
    requests. `png(byte)` builds a tiny recognisable PNG.
  - Linking: `fakeProvisioning()` plays the provisioning service and the phone (`scan(qrUrl)`,
    `scanWhenShown(progress)`, `interrupt(socket)`); `linkDeviceByScanning()` is the real
    `linkDevice` over it. `fakeChat(respond)` records chat requests and answers them, e.g. with
    `LINK_RESPONSE`. `memoryCredentialsStore(initial)` and `CREDENTIALS` stand in for the config
    file.
  - Push: `validPack(count)` and `writePackFolder(pack, images)` build a pack folder that passes
    validation, `stickerPng(byte, options)` and `imageFixture(name)` make images, `fakeUploadChat()`
    hands out upload forms for `NEW_PACK_ID`, and `memoryCdn()` records uploads and serves them
    back, so a pushed pack pulls back through `pullPack`.
  - `tempDir()` creates a directory that is removed after the test.
- cli tests go through `runCli` (`packages/cli/test/support.ts`). Every service, the credentials
  store, and each core operation default to fakes, and an operation a test does not pass fails if
  called, so tests never reach the real config directory or Signal.
- server tests start a real loopback server with `serve()` or `servePack()`
  (`packages/server/test/support.ts`), injecting core operations through `deps`; the server CLI
  tests pass a temporary `configDir`. `rawRequest` sets headers that `fetch` cannot, such as `Host`,
  and `listenForEvents` collects WebSocket events.
- cli and server each have a few tests that run the real core operations over these fakes (link,
  unlink, push, validation), so the front ends and core cannot drift apart.
- web tests render components with `@testing-library/svelte` against `fakeApi()`
  (`packages/web/test/support/api.ts`). They mock `emoji-picker-element` and fire its `emoji-click`
  event, and inject the image encoder, since jsdom has no canvas.

## Crypto and protocol

Every crypto change needs a round-trip and a known-answer test. The vectors in
`test/stickers/crypto.test.ts` were computed with OpenSSL, and those for the provisioning cipher and
the device name with `node:crypto` alone, independently of the code under test and libsignal. The
protobuf tests pin the exact wire bytes. The sample images in `test/fixtures/images` were made with
Pillow, each a different size so a swapped width and height shows.

## Network

`test/net/http.test.ts` runs a local HTTPS server (`serveHttps`, `serveAndRecord`) with a
self-signed certificate from `test/fixtures` to check CA pinning, status handling, size limits,
aborts, and timeouts. `chat.test.ts` and the upload tests in `cdn.test.ts` run the real clients
against it by mocking `signalCa.ts` to `TEST_CA` and `getEnvironmentConfig` to the local origin.
Production code has no CA or URL override.

## Platform-specific tests

The credentials store test checks the Windows ACL with `icacls` on Windows and the `0600` mode on
POSIX; each skips on the other platform, so CI covers both. The working copy test of the `0700`
folders it creates runs on POSIX only.

## Manual checks

These hit Signal and need a person, so they are not automated. Try them on staging first where you
can; staging needs a phone registered on Signal's staging servers.

1. **Pull** a real pack: `pnpm pull "https://signal.art/addstickers/#pack_id=…&pack_key=…" ./pack`
2. **Link** with your phone: run `pnpm run link`, then in Signal on the phone open Settings > Linked
   devices > Link new device and scan the QR code within 45 s (a later code also works). Check that
   a device named `signal-stickers` appears on the phone and that `pnpm status` shows its aci and
   device id. Check the credentials file is owner-only: on Windows,
   `icacls "%APPDATA%\signal-stickers\credentials.json"` lists only you with `(F)`; on POSIX,
   `ls -l` shows `-rw-------`.
3. **Push** a one-sticker pack with `pnpm push`, then pull the printed link back and compare.
4. **Web**: run `pnpm dev` (or `pnpm start`), and link, import, edit, and publish in a real browser,
   including adding a large or non-square image to check the canvas conversion.
5. **Unlink** with `pnpm run unlink` and check the device disappears from the phone. After linking
   again, `pnpm run unlink --local` deletes the credentials and leaves the device on the phone to
   remove there.
