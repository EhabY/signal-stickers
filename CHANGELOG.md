# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

- Keep saved credentials private to your Windows user on every setup
- Refuse a link whose account differs from the one the phone sent
- Refuse to push a pack where two stickers share an image
- Reject oversized sticker files without loading them
- Stop saying the web UI is not built when the dev server serves it
- Explain what to do when the browser cannot make WebP stickers
- Remove the sticker you clicked when two share an image
- Treat single-frame WebPs as still images, not animations


