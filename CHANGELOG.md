# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-25

### Added

- Add `pull` to download and decrypt a sticker pack from its link
- Add `link`, `status`, and `unlink` to manage the linked device
- Add `push` to upload a pack folder as a new sticker pack
- Serve a local API to link, pull, edit, and upload packs
- Start the editor from the command line and open a browser
- Import a sticker pack and edit it in the browser
- Link your Signal account and publish packs from the browser
- Forget this device locally with `unlink --local`
- Warn in status when the selected environment is not the device's
- Keep the edited pack in the tool's config folder by default
- Ask before an import replaces the pack you are editing
- Publish a pack only once until you change it
- Choose a separate cover image again after picking a sticker
- Highlight the cover and tuck sticker actions into a hover toolbar
- Choose the cover with a "Set as cover" button instead of a star
- Flag animated WebP stickers, since Signal animates only APNG
- Turn animated GIFs and WebPs into animated PNG stickers
- Convert an animated WebP already in the pack with one click
- Keep editing the pack while images convert
- Let stickers without an emoji through as a warning
- Warn when pushing stickers without an emoji
- Mark stickers without an emoji as a warning that allows publishing
- Say what size, frame rate, and file size a conversion made
- Add theme choice and polish the pack editor
- Convert animations in Safari and other WebKit browsers
- Reopen the running editor and stop once it is closed
- Download the editor as an app for Windows, macOS, and Linux
- Show a tray icon to reopen the editor or quit the app
- Say when the app stops, and reconnect once it starts again
- Close older editor tabs when the app opens a new one

[0.1.0]: https://github.com/EhabY/signal-stickers/releases/tag/v0.1.0

