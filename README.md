# signal-stickers

Import, edit, and re-upload [Signal](https://signal.org) sticker packs, without Signal Desktop.

> Early development. Expect rough edges, and see [How it works](#how-it-works) before linking.

## Requirements

- Node.js 24 or newer
- pnpm (`corepack enable pnpm`)

```sh
pnpm install
```

## Edit in the browser

```sh
pnpm start
```

This builds the editor, serves it on this computer only (127.0.0.1), and opens it in your browser.
Paste a pack's share link to import it, then edit the title and author, pick an emoji for each
sticker, drag stickers into order, choose a sticker or a separate image as the cover, and add or
remove images. Added images are converted to 512x512 WebP in the browser, unless they are still PNG
or WebP images that already fit. A sticker without an emoji gets an amber **+** badge: it can still
be published, but Signal never suggests it while typing.

Signal animates only APNG (animated PNG) stickers. The editor turns an added GIF, animated WebP, or
APNG that breaks Signal's rules into a square APNG that loops forever and fits in 300 KiB. To keep
the motion smooth, it makes the image smaller (down to 160 pixels) and uses fewer colors before it
drops frames, and then says what it made, such as `320×320, 30 fps, 284 KiB`. This needs a browser
with WebCodecs' `ImageDecoder` support for the image type and `OffscreenCanvas`. Elsewhere a GIF or
animated WebP becomes a still image, as in Signal's own sticker creator, and an APNG must already
fit. An animated WebP already in the pack, such as one from an imported pack, shows a **Convert to
animated PNG** button that converts it in place, keeping its position, emoji, and cover; **Convert
all to animated PNG**, shown when there are several, does every one.

Conversions run in the background, and the pack stays fully editable meanwhile: change emoji, the
title, or the order, remove stickers, add more images, or start other conversions. Each conversion
shows its progress and its own **Cancel**. Removing a sticker that is being converted cancels its
conversion, and publishing waits until every conversion and pending image change is done.

To upload, link your account from the Account tab by scanning its QR code with your phone (see
[Link your account](#link-your-account)), then publish from the Publish tab. It lists anything
Signal would reject and notes stickers without an emoji, and once uploaded shows the new pack's link
and QR code. Publishing is disabled during imports and uploads. Each publish makes a new pack, so
publishing again waits until you change something.

Every change is saved to a `pack` folder next to the credentials (see
[Link your account](#link-your-account)), which the server prints when it starts:

- Windows: `%APPDATA%\signal-stickers\pack`
- macOS: `~/Library/Application Support/signal-stickers/pack`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/signal-stickers/pack`

`pnpm start --dir ./my-pack` picks another folder, such as one the command line pulled into (it uses
`./pack` by default). Importing a pack replaces that folder, which must hold a pack, be empty, or
not exist yet, so the editor asks first when you are editing a pack. A failed import keeps the
previous working pack. Choosing a sticker as the cover also asks first if it replaces an uploaded
cover image. Add `--staging` for Signal's staging servers, `--no-open` to skip opening the browser,
or `--port` to choose the port.

## Pull a pack

Download and decrypt any pack from its share link. No Signal account is needed.

```sh
pnpm pull "https://signal.art/addstickers/#pack_id=…&pack_key=…" ./my-pack
```

This writes the images (`001.png`, `002.webp`, …) and a `pack.json` with the title, author, cover,
and each sticker's emoji. The folder must be empty or not exist yet. Images finish downloading
before any files are written. If a write fails, the files created by that pull, including partial
files, are removed after the other writes finish.

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

`status` warns when `--staging` or `SIGNAL_STICKERS_ENV` selects another environment than the one
the device was linked in.

If Signal cannot be reached, or the saved credentials no longer load, `pnpm run unlink --local` only
deletes the credentials. Remove `signal-stickers` from Linked devices on your phone too, if it is
still there.

## Push a pack

Upload a pack folder as a new sticker pack on your linked account:

```sh
pnpm push ./my-pack
```

The folder needs a `pack.json` with a title, an author, a cover, and 1 to 200 stickers of at most
300 KiB each: 512x512 PNG or WebP images, or square APNGs from 10x10 to 512x512 that loop forever.
Signal animates only APNG, so a WebP with two or more frames is rejected too; a WebP animation of a
single frame counts as a still image. Each sticker needs its own image; only the cover may repeat
one. `push` checks all of this first and lists every problem before uploading anything; it does not
resize images. A sticker may go without an emoji, but Signal never suggests it while typing, so
`push` warns about each one before uploading, then uploads it anyway. It prints the new pack's share
link, and its QR code in a terminal.

Each push creates a new pack with a new link; Signal packs cannot be changed once uploaded. Use the
same environment you linked with: a device linked with `--staging` only pushes with `--staging`.

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
