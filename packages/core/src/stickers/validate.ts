import { NotImplementedError } from "../util/notImplemented.ts";
import type { ImageFormat } from "./image.ts";
import type { Pack } from "./pack.ts";

/** Signal's limits for creating a pack; readers accept more (see `MAX_STICKERS_PER_PACK`). */
export type StickerLimits = Readonly<{
	minStickers: number;
	maxStickers: number;
	/** Width and height in pixels; the most an APNG may have, since Signal uploads APNGs unchanged. */
	size: number;
	/** The least width and height of a square APNG. */
	minAnimatedSize: number;
	maxBytes: number;
}>;

export const STICKER_LIMITS: StickerLimits = {
	minStickers: 1,
	maxStickers: 200,
	size: 512,
	minAnimatedSize: 10,
	maxBytes: 300 * 1024,
};

export type ImageInfo = Readonly<{
	format: ImageFormat;
	width: number;
	height: number;
	/** How many times an APNG plays, 0 meaning forever; undefined for an image that does not animate. */
	plays?: number | undefined;
}>;

export type ValidationCode =
	| "missingTitle"
	| "missingAuthor"
	| "tooFewStickers"
	| "tooManyStickers"
	| "missingEmoji"
	| "missingImage"
	| "unsupportedFormat"
	| "wrongSize"
	| "mustLoopForever"
	| "tooLarge";

/** Something that would stop a push. `file` names the image for per-sticker issues. */
export type ValidationIssue = Readonly<{
	code: ValidationCode;
	message: string;
	file?: string | undefined;
}>;

export class PackValidationError extends Error {
	override name = "PackValidationError";
	readonly issues: readonly ValidationIssue[];

	constructor(issues: readonly ValidationIssue[]) {
		super(issues.map(({ message }) => message).join("\n"));
		this.issues = issues;
	}
}

/** Reads the format, dimensions, and APNG play count from PNG/APNG/WebP headers. */
export function readImageInfo(_bytes: Uint8Array): ImageInfo | undefined {
	throw new NotImplementedError("readImageInfo");
}

/** Checks one image's format, size, and byte length against {@link STICKER_LIMITS}. */
export function validateImage(_file: string, _bytes: Uint8Array): ValidationIssue[] {
	throw new NotImplementedError("validateImage");
}

/**
 * Checks a pack for push: title, author, sticker count, an emoji per sticker, and every image it
 * names, the cover included. `images` maps file names to their bytes; a missing entry is reported.
 */
export function validatePack(
	_pack: Pack,
	_images: ReadonlyMap<string, Uint8Array>,
): ValidationIssue[] {
	throw new NotImplementedError("validatePack");
}
