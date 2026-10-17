# Testing

Tests use [Vitest](https://vitest.dev). The root `vitest.config.ts` defines one project per tested
package; add a package there when it gets tests.

```sh
pnpm test                                   # everything
pnpm test:coverage                          # with a coverage report
pnpm --filter core test                     # one package
pnpm --filter core test test/stickers/pull  # one file
```

## Writing tests

- Read top to bottom: arrange, act, assert. One behaviour per test.
- Reuse the kit in `packages/core/test/support` (`@signal-stickers/core/testing`):
  - `fakeCdn(manifest, { images, failingStickerId })` serves an encrypted pack in memory, records
    sticker requests, and can fail one sticker.
  - `PACK_ID`, `PACK_KEY`, `PACK_LOCATOR`, `PACK_LINK`, `PACK_KEYS` describe that pack.
  - `png(byte)` builds a tiny recognisable PNG.
  - `tempDir()` creates a directory that is removed after the test.
- Prefer a small local helper (like `pull()` in `pull.test.ts`) over `beforeEach` chains, and
  `it.each` tables over copy-pasted tests.

## Crypto and protocol

Every crypto change needs a round-trip and a known-answer test. The vectors in
`test/stickers/crypto.test.ts` were computed with OpenSSL, independently of `node:crypto`. The
protobuf tests pin the exact wire bytes.

## Network

`test/net/cdn.test.ts` mocks the HTTP layer with `vi.mock` to pin CDN URLs, redaction, and the CA.

`test/net/http.test.ts` runs a local HTTPS server with a self-signed certificate from
`test/fixtures` to check CA pinning, status handling, size limits, aborts, and timeouts. No test
talks to Signal.

## Manual checks

Pulling a real pack hits Signal's production CDN, so it is not automated:

```sh
pnpm pull "https://signal.art/addstickers/#pack_id=…&pack_key=…" ./pack
```

Linking a device will also need a phone to scan the QR code.
