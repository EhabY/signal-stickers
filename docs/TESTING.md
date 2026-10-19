# Testing

```sh
pnpm test
pnpm --filter core test
pnpm --filter core test test/stickers/pull.test.ts
pnpm test:coverage
```

Vitest runs core, CLI, and server tests in Node and web tests in jsdom. Automated tests never
contact Signal or use real credentials.

## Fixtures

| Area                 | Test support                                                                          |
| -------------------- | ------------------------------------------------------------------------------------- |
| Core and integration | `packages/core/test/support/`, also exported as `@signal-stickers/core/testing`       |
| CLI                  | `packages/cli/test/support.ts`: command runner with injected services                 |
| Server               | `packages/server/test/support.ts`: loopback server, requests, and WebSocket events    |
| Web                  | `packages/web/test/support/`: fake API, session, drawing, decoder, and worker helpers |

Reuse the fake CDN, chat service, provisioning transport, pack builders, and temporary directories.
Tests should arrange, act, and assert linearly. Cover behavior rather than implementation details.

Crypto changes require a round-trip or known-answer test. Protobuf tests pin wire bytes; HTTPS tests
use a local certificate to verify CA pinning, timeouts, cancellation, and response limits. Platform
tests check Windows ACLs or POSIX file modes and skip on other platforms.

## Manual integration

These checks contact Signal and require explicit authorization. Prefer staging with a staging
account.

1. Link through the CLI or Account tab by scanning the QR code on a phone. Confirm the device name
   and owner-only credential permissions.
2. Import, edit, and publish a small pack. Pull the new link back and compare the images and emoji.
3. In the browser, check still and animated image conversion, cancellation, editing during
   conversion, cover replacement, and publishing availability.
4. Unlink and confirm the device disappears from the phone. With `unlink --local`, remove it on the
   phone manually.

The [compatibility reference](SIGNAL_COMPAT.md) records the last production verification.
