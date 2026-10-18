import type {
	Environment,
	LinkProgress,
	LinkStatus,
	Pack,
	PullProgress,
	PushProgress,
	StickerLimits,
	ValidationIssue,
} from "@signal-stickers/core";

/**
 * The REST API, keyed by `"METHOD /path"`. Bodies are JSON unless noted. Failures respond with a
 * non-2xx status and an {@link ErrorResponse}; 409 means another link, pull, or push is running.
 */
export type ApiRoutes = {
	"GET /api/status": { request: undefined; response: StatusResponse };
	/**
	 * Links a device and responds once it is linked. Progress, including the QR URL, arrives as
	 * `link` events. Aborting the request cancels linking.
	 */
	"POST /api/link": { request: undefined; response: StatusResponse };
	/** Removes this device from the account and deletes its credentials. */
	"POST /api/unlink": { request: undefined; response: StatusResponse };
	/** Replaces the working copy with a downloaded pack. Progress arrives as `pull` events. */
	"POST /api/pull": { request: PullRequest; response: PackResponse };
	/** 404 when there is no working copy. */
	"GET /api/pack": { request: undefined; response: PackResponse };
	/** Replaces `pack.json`; every file it names must already be in the working copy. */
	"PUT /api/pack": { request: Pack; response: PackResponse };
	/** The working copy's image `file` (URI-encoded), sent uncached. */
	"GET /api/pack/sticker/:file": { request: undefined; response: Blob };
	/** Appends a sticker without an emoji. The body is the image itself (PNG or WebP), not JSON. */
	"POST /api/pack/sticker": { request: Blob; response: AddStickerResponse };
	/**
	 * Removes the sticker at position `index` (from 0), and its image unless the pack still uses it.
	 * 404 unless that sticker's image is `file` (URI-encoded), so a stale position removes nothing.
	 */
	"DELETE /api/pack/sticker/:index/:file": { request: undefined; response: PackResponse };
	/**
	 * Replaces the image of the sticker at `index`, keeping its place and emoji, and the cover if it
	 * was that image. The image is saved under a new name; the old one is removed unless the pack
	 * still uses it. 404 unless that sticker's image is `file`, like DELETE. The body is the image
	 * itself (PNG or WebP), not JSON.
	 */
	"PUT /api/pack/sticker/:index/:file": { request: Blob; response: PackResponse };
	/**
	 * Makes the image the separate cover, saved as `cover.png` or `cover.webp` in place of any
	 * earlier separate cover. The body is the image itself (PNG or WebP), not JSON.
	 */
	"PUT /api/pack/cover": { request: Blob; response: PackResponse };
	/** Uploads the working copy as a new pack. Progress arrives as `push` events. */
	"POST /api/push": { request: undefined; response: PushResponse };
};

export type ApiRoute = keyof ApiRoutes;

export type StatusResponse = Readonly<{
	/** The environment this server was started for. */
	env: Environment;
	link: LinkStatus;
	/** For the editor, which converts added images to fit them. */
	limits: StickerLimits;
}>;

export type PullRequest = Readonly<{ link: string }>;

export type PackResponse = Readonly<{
	pack: Pack;
	/**
	 * Errors, which stop a push, and warnings, such as a sticker without an emoji, which do not. Empty
	 * when there is nothing to tell.
	 */
	issues: readonly ValidationIssue[];
}>;

export type AddStickerResponse = PackResponse & Readonly<{ file: string }>;

export type PushResponse = Readonly<{ link: string }>;

export type ErrorResponse = Readonly<{
	error: string;
	/** Present when a push was refused because the pack has errors; holds only the errors. */
	issues?: readonly ValidationIssue[] | undefined;
}>;

/** The WebSocket path. The server only sends, broadcasting each {@link ServerEvent} as JSON. */
export type EventsPath = "/api/events";

export type ServerEvent = Readonly<
	| { type: "link"; progress: LinkProgress }
	| { type: "pull"; progress: PullProgress }
	| { type: "push"; progress: PushProgress }
>;
