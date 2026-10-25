# signal-stickers

Import, edit, and publish [Signal](https://signal.org) sticker packs from a local web editor or CLI.
No Signal Desktop installation required.

## Download

Each [release](https://github.com/EhabY/signal-stickers/releases/latest) has an app for Windows,
macOS, and Linux, on x64 and arm64, and needs nothing else installed: a `.7z` for Windows (Windows
11 opens it), a `.dmg` for macOS, and a `.tar.xz` for Linux. Open the app inside: the editor opens
in your browser, and a tray icon (in the menu bar on macOS) reopens the editor or quits. The app
also quits five minutes after you close the editor.

The app is not signed by a publisher your system knows, so the first launch needs one extra step:

- **Windows:** at "Windows protected your PC", choose **More info**, then **Run anyway**.
- **macOS:** drag `Signal Stickers.app` to Applications and open it, then allow it in **System
  Settings > Privacy & Security** with **Open Anyway**.
- **Linux:** run `signal-stickers`.

Each archive has a build provenance attestation:

```sh
gh attestation verify signal-stickers-windows-x64.7z --repo EhabY/signal-stickers
```

## Quick start

To run from source, install Node.js 24+ and pnpm.

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

The editor stops five minutes after you close it, and starting it again for the same folder reopens
the running one. Use `pnpm start --dir ./my-pack` to choose the working folder. Server options
include `--port <number>` and `--no-open`, which keeps the server running until you stop it.

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

Without the source, use the release's `signal-stickers-cli.mjs` with Node.js 24 or later. `pull`
works on its own. Linking, pushing, and the other account commands also need Signal's native library
in the same folder, at the version the release notes name:

```sh
npm install @signalapp/libsignal-client@<version>
node signal-stickers-cli.mjs pull "<pack share link>" ./my-pack
```

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

The directory holds `credentials.json` and the web editor's `pack/` folder, which keeps the pack you
are editing until you import another. Credentials are stored as plaintext with owner-only
permissions. Keep them private: they grant access as this device.

## Development

See [Contributing](CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md),
[Testing](docs/TESTING.md), and [Signal compatibility](docs/SIGNAL_COMPAT.md).

This is an unofficial Signal project. Use artwork you have permission to publish and follow Signal's
Terms of Service. Licensed under [AGPL-3.0-only](LICENSE).
