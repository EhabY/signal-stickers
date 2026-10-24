# signal-stickers

Import, edit, and publish [Signal](https://signal.org) sticker packs from a local web editor or CLI.
No Signal Desktop installation required.

## Quick start

Requires Node.js 24+ and pnpm.

```sh
corepack enable pnpm
pnpm install
pnpm start
```

Import a pack's share link, edit its title, artwork, order, cover, and emoji, then publish a new
pack. Importing needs no account. Publishing requires linking this tool from the Account tab by
scanning a QR code in Signal on your phone.

The editor runs on `127.0.0.1` and saves changes locally. It resizes still images and converts
animations to APNG in any current browser; one without `OffscreenCanvas` turns GIF and WebP
animations into still images.

Use `pnpm start --dir ./my-pack` to choose the working folder. Server options include
`--port <number>` and `--no-open`.

## CLI

```sh
pnpm pull "<pack share link>" ./my-pack
pnpm run link
pnpm push ./my-pack
pnpm status
pnpm run unlink
```

`pull` writes images and a `pack.json` into an empty folder. Edit that folder and `push` it to
create a new pack with its own share link. The CLI validates images without resizing them.

Use `pnpm run link` and `pnpm run unlink`: the shorter forms are pnpm's own commands. If Signal is
unreachable, `pnpm run unlink --local` deletes credentials only; remove the device from your phone's
Linked devices too.

Production is the default. Add `--staging` or set `SIGNAL_STICKERS_ENV=staging` to use staging.
Uploads must use the environment in which the device was linked.

## Pack requirements

- A title, author, cover, and 1 to 200 stickers.
- PNG or WebP at 512×512, or square APNG at 10×10 to 512×512 that loops forever.
- At most 300 KiB per image. Only APNG animates in Signal.
- Each sticker needs a distinct image. The cover can reuse one.
- Emoji are optional; stickers without them are not suggested while typing.

## Local data

This tool links as its own device named `signal-stickers`. It never reads Signal Desktop's data.
Remove the device at any time in Signal: **Settings > Linked devices**.

| Platform | Config directory                                |
| -------- | ----------------------------------------------- |
| Windows  | `%APPDATA%\signal-stickers`                     |
| macOS    | `~/Library/Application Support/signal-stickers` |
| Linux    | `${XDG_CONFIG_HOME:-~/.config}/signal-stickers` |

The directory holds `credentials.json` and the web editor's `pack/` folder. Credentials are stored
as plaintext with owner-only permissions. Keep them private: they grant access as this device.

## Development

See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md),
[Testing](docs/TESTING.md), and [Signal compatibility](docs/SIGNAL_COMPAT.md).

This is an unofficial Signal project. Use artwork you have permission to publish and follow Signal's
Terms of Service. Licensed under [AGPL-3.0-only](LICENSE).
