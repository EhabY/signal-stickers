# Architecture

signal-stickers imports, edits, and re-uploads Signal sticker packs without Signal Desktop. It links
itself as its own Signal device and never reads another app's data.

## Constraint: the engine runs in Node

`@signalapp/libsignal-client` is a native Node addon, so device linking and Signal crypto must run
in a Node process. Everything else follows from that:

```
cli ──┐
      ├──► core (Node: crypto, chat service, CDN, pack folders, linking, upload)
server┘        ▲
  ▲            │ imported directly
  │ HTTP + WS
 web (browser UI, talks only to server)
```

- **core** is the engine. It has no HTTP server, DOM, or argv parsing, and reports progress through
  callbacks and `AbortSignal`s, so any front end can drive it.
- **cli** and **server** are thin front ends over core.
- **web** is a Vite + Svelte app served by server. It never imports core or server at runtime; it
  shares only the API types in `server/src/api.ts`.

An Electron app can later import core in its main process, or spawn server, and load web as the
renderer without changing these packages.

core loads libsignal only through dynamic `import()` (`account/libsignal.ts`), so `pull` never loads
the native addon. Keep static imports from libsignal type-only: esbuild hoists static imports of
external packages to the top of the CLI bundle.

## Pull

Pulling needs no account.

1. Parse the `signal.art` link into a pack id and key (`stickers/link.ts`).
2. Derive the AES and MAC keys from the pack key (`stickers/crypto.ts`).
3. Download and decrypt `manifest.proto` from the CDN, then decode it (`protocol/protobuf.ts`).
4. Download and decrypt each sticker, three at a time, plus a separate cover if the manifest names
   one outside the sticker list (`stickers/pull.ts`).
5. Write `001.png`, `002.webp`, …, an optional `cover.*`, and `pack.json` (`stickers/pack.ts`).
   Nothing is written until every image has downloaded, and the first failed download cancels the
   others. Files are created exclusively, so nothing that appears in the folder meanwhile is
   overwritten, and a failed write removes what was written.

All requests use Signal's pinned CA (`net/signalCa.ts`); the default root store is not trusted.

## Link

`linkDevice` (`account/link.ts`) provisions this tool as a new device named `signal-stickers`:

1. `waitForScan` (`account/scan.ts`) opens a provisioning socket through libsignal
   (`account/provisioningTransport.ts`) and reports a QR URL with the socket's address and a fresh
   public key. Like Signal Desktop it shows a new code every 45 s while the previous one stays
   scannable, and gives up after six.
2. The phone sends an encrypted `ProvisionMessage`; `account/provisioningCipher.ts` decrypts it into
   the account's identity keys, aci, pni, number, and provisioning code.
3. `registerDevice` (`account/register.ts`) generates a registration id, password, and signed
   prekeys (`account/keys.ts`), encrypts the device name (`account/deviceName.ts`), and sends
   `PUT /v1/devices/link`. Like Signal Desktop, it refuses a reply that names another ACI or PNI
   than the phone sent.
4. The front end saves the returned credentials with a `CredentialsStore`.

Progress (`connecting`, `waitingForScan` with the QR URL, `registering`, `done`) carries no secrets,
so front ends forward it as is. `unlinkDevice` sends `DELETE /v1/devices/{id}`; the front end then
deletes the credentials. The CLI's `unlink --local` only deletes them, for when Signal cannot be
reached or the credentials no longer load.

Chat requests go through `net/chat.ts`: JSON over the pinned CA with Basic auth, where the username
is `aci.deviceId` (`getChatAuth`).

## Credentials

`createCredentialsStore` (`account/credentials.ts`) keeps one account in `credentials.json` in the
tool's own config directory (`%APPDATA%\signal-stickers`, `~/Library/Application Support/...`, or
`$XDG_CONFIG_HOME/signal-stickers`). The file is written to a temporary file and renamed, and is
owner-only: mode `0600` on POSIX, and an `icacls` ACL granting only the current user on Windows.
Front ends show `credentialsWarning(path)` after linking. The password never leaves core: status
goes through `getLinkStatus`, which drops it.

## Push

`pushPack` (`stickers/push.ts`) uploads a pack folder as a new pack:

1. Read `pack.json` and its images (`stickers/validateFolder.ts`), leaving any over the size limit
   unread, and check them against Signal's limits (`stickers/validate.ts`). Each issue is an error
   or a warning. Warnings, such as a sticker without an emoji, which Signal then never suggests
   while typing, go to `onWarnings` and do not stop the push. Then any error throws a
   `PackValidationError` listing every error, before any request.
2. Build and encrypt the manifest and images under a fresh pack key (`stickers/encryptPack.ts`). The
   cover reuses a sticker's id when it is the same image, as Signal's sticker creator does.
3. Ask the chat service for upload forms: `GET /v1/sticker/pack/form/{count}`.
4. Upload the manifest, then the images three at a time, to the CDN as S3 multipart forms
   (`net/cdn.ts`), reporting `{ done, total }` after each.
5. Return the new pack's `signal.art` link.

## Server

`startServer` (`server/src/server.ts`) serves the API, one WebSocket for progress events, and the
built web app. It has no login, so it guards the user's account by:

- listening on `127.0.0.1` only;
- rejecting any `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, which stops DNS
  rebinding;
- rejecting any `Origin` other than its own (or one passed with `--allow-origin`), which stops other
  sites' pages, on every request and WebSocket upgrade;
- forbidding other sites to frame its pages, where they could trick the user into clicking.

Routes (`server/src/routes.ts`) are typed against `ApiRoutes` in `server/src/api.ts`, the contract
with web. Link, unlink, pull, and push run one at a time (409 otherwise), and abort when the client
disconnects. Their progress goes out as WebSocket events while the request stays open.

The server edits one working copy (`server/src/workingCopy.ts`), by default a `pack` folder in the
tool's config directory, so it does not depend on where the server starts. Edits are queued one at a
time. A pull writes into a sibling folder and swaps it in, so a failed pull keeps the old copy.
Image routes only serve files that `pack.json` names, and added images get server-chosen names.
Removing the cover's sticker makes the first remaining sticker the cover. A separate cover is saved
as `cover.png` or `cover.webp` (`PUT /api/pack/cover`), replacing the previous separate cover.
Replacing a sticker's image (`PUT /api/pack/sticker/:index/:file`) saves it under a new name in the
same place, with the same emoji, and as the cover if the old image was.

## Web

The browser app talks to the server through a typed `fetch` client (`web/src/lib/api.ts`) and one
WebSocket (`lib/events.svelte.ts`). `PackSession` (`lib/packSession.svelte.ts`) holds the pack being
edited, shows edits at once, and saves them shortly after. Every request that changes the pack
(saves, adds, removals, in-place replacements, cover changes) waits its turn in one queue and goes
out only after pending edits are saved, so the server has the pack as shown. Its answer becomes the
shown pack, unless the pack was edited while the request was out; then the same change is made to
the edited pack (`lib/packChanges.ts`), which is saved next. Only a pull or push, which the server
will not overlap with edits, locks the editor; both run through the same queue. Every save returns
the pack's validation issues, so the editor shows them live without duplicating Signal's rules.
Errors must be fixed before publishing; warnings show as notes and leave publishing enabled. A
sticker without an emoji gets an amber dashed badge instead of the red outline of an error. Added
images are converted in the browser with a `<canvas>` (`lib/stickerImage.ts`): still PNG and WebP
images that already fit are kept as they are; anything else becomes a 512x512 WebP within the size
limit. Browsers without a WebP encoder, such as Safari, give back a lossless PNG instead, which is
kept if it fits; otherwise the error says which images still work.

Animations become APNG, the only animated format Signal shows. `lib/animatedImage.ts` reads the
header: a GIF with more than one frame, a WebP with the `VP8X` animation flag and more than one
`ANMF` frame, or a PNG with `acTL`. A WebP with the flag but a single frame is redrawn as a plain
still WebP, even when it fits. An APNG that Signal takes as it is (square, 10 to 512 pixels, looping
forever, within 300 KiB) is kept; any other animation goes to a module worker
(`lib/animationWorker.ts`), so the page stays responsive. The worker decodes frames and their
durations with WebCodecs' `ImageDecoder`, draws each one fitted in a transparent square on an
`OffscreenCanvas`, and encodes with upng-js (palette quantization, skipped when the frames have
fewer colors than the palette holds, and frame deltas, `num_plays` 0). `lib/apng.ts` fits the result
in 300 KiB, keeping the frame rate as long as it can, since a low frame rate shows more than a small
sticker: each size from the image's longer side (at most 512) down to 160 with 256 colors, then 128
and 64 colors, then all of that again keeping 2 of every 3 frames, then 1 of 2, then 1 of 3 (each
kept frame also shows for the time of those dropped after it), then 128 pixels, and as a last resort
every other frame dropped again until two remain. A smaller size never encodes larger, so after
trying the image as it is, each pass tries its smallest size first, which is all a pass where
nothing fits costs, and then bisects the sizes above it. Over 150 frames, 150 frames spread evenly
are drawn. The worker posts progress, which the editor shows with the frame rate, then the APNG and
its encoding, which the editor reports for a few seconds, `still` for a single frame, `unsupported`
when the browser cannot decode the type, or an error. Like Signal's creator, the page draws a single
frame, and a GIF or WebP the browser cannot decode, as a still WebP; such an APNG is refused. The
protocol and the decoder interface live in `lib/animationConversion.ts`, so tests run it with a fake
decoder.

Conversions (`lib/conversions.svelte.ts`) run while the pack stays editable, each listed with its
progress and a Cancel that terminates its worker. Images chosen together convert one after another;
separate choices convert side by side. A finished conversion applies to the pack as it is then: an
added image is appended, an in-place conversion finds its sticker by position and image and is
dropped if that sticker was removed or replaced meanwhile, a converted cover applies only if the
cover is still the image it replaces, and an uploaded cover applies unless another cover is chosen.
A removal also finds its sticker by position and image, following an in-place replacement. Removing
the sticker or choosing another cover cancels the conversion; importing another pack cancels them
all and ignores answers to requests already sent. Publishing waits until no conversion or change is
pending.

The editor animates only what Signal animates. A pack image the server flags `unsupportedAnimation`
(an animated WebP, from a pulled pack or the disk) shows only its first frame: `PackImage.svelte`
fetches it, draws it on a canvas (`lib/stillImage.ts`), and shows that as an object URL, revoked
once no longer shown. Its sticker card, or the separate cover, offers to convert it, and the issues
summary to convert them all: `PackSession.convertAnimations` downloads each image, converts it like
an added animation (refusing to flatten it, so the original stays when the browser cannot convert),
and saves it with `PUT /api/pack/sticker/:index/:file`, or `PUT /api/pack/cover` for a separate
cover. The app talks to nothing but the local server: the emoji picker's data
(`emoji-picker-element-data`) is bundled by Vite as an asset.

## Environments

Production is the default. Staging is opt-in with `--staging` or `SIGNAL_STICKERS_ENV=staging`, and
the CLI and server print which one they use. Saved credentials remember their environment: unlinking
always uses it, pushing refuses credentials from the other environment, and the CLI's `status` warns
when the selected environment is not theirs.

Signal-side details that could change are tracked in [SIGNAL_COMPAT.md](SIGNAL_COMPAT.md).
