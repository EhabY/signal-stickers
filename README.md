# signal-stickers

Import, edit, and re-upload [Signal](https://signal.org) sticker packs, without Signal Desktop.

> Early development. Pulling packs and linking a device work today; uploading and the web editor are
> in progress.

## Requirements

- Node.js 24 or newer
- pnpm (`corepack enable pnpm`)

```sh
pnpm install
```

## Pull a pack

Download and decrypt any pack from its share link. No Signal account is needed.

```sh
pnpm pull "https://signal.art/addstickers/#pack_id=…&pack_key=…" ./my-pack
```

This writes the images (`001.png`, `002.webp`, …) and a `pack.json` with the title, author, cover,
and each sticker's emoji. The folder must be empty or not exist yet.

Add `--staging` (or set `SIGNAL_STICKERS_ENV=staging`) to use Signal's staging servers.

## Link your account

Uploading needs this tool linked to your Signal account as a device of its own, the way Signal
Desktop links:

```sh
pnpm run link
```

Scan the QR code in the Signal app on your phone (Settings > Linked devices > Link new device). The
device shows up there as `signal-stickers`, and you can remove it from your phone at any time.

The device's credentials are saved, readable only by you, in:

- Windows: `%APPDATA%\signal-stickers\credentials.json`
- macOS: `~/Library/Application Support/signal-stickers/credentials.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/signal-stickers/credentials.json`

Keep this file secret: anyone who has it can act as this device until you unlink it.

```sh
pnpm status       # which account and environment this tool is linked to
pnpm run unlink   # remove the device from your account and delete the credentials
```

## How it works

The tool talks to Signal's servers directly using Signal's own certificate authority. To upload
packs it links itself as a new device on your account, the same way Signal Desktop does, by scanning
a QR code with your phone. It never reads Signal Desktop's data, and you can remove the device from
your phone at any time.

Signal's server API is not public and may change; see [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md)
for what this tool depends on.

## Caveats

- You are responsible for the artwork you re-upload and for following Signal's Terms of Service.
- This is not an official Signal project.

## License

[AGPL-3.0-only](LICENSE)
