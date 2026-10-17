# signal-stickers

Import, edit, and re-upload [Signal](https://signal.org) sticker packs, without Signal Desktop.

> Early development. Pulling packs works today; linking a device, uploading, and the web editor are
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

## How it works

The tool talks to Signal's servers directly using Signal's own certificate authority. To upload
packs it will link itself as a new device on your account, the same way Signal Desktop does, by
scanning a QR code with your phone. It never reads Signal Desktop's data, and you can remove the
device from your phone at any time.

Signal's server API is not public and may change; see [docs/SIGNAL_COMPAT.md](docs/SIGNAL_COMPAT.md)
for what this tool depends on.

## Caveats

- You are responsible for the artwork you re-upload and for following Signal's Terms of Service.
- This is not an official Signal project.

## License

[AGPL-3.0-only](LICENSE)
