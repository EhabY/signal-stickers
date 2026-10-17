import { sniffImageFormat, type ImageFormat } from "./image.ts";
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
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
	const format = sniffImageFormat(bytes);
	if (format === "png") {
		return readPngInfo(bytes);
	}
	if (format === "webp") {
		return readWebpInfo(bytes);
	}
	return undefined;
}

/**
 * Checks one image's format, size, looping, and byte length against {@link STICKER_LIMITS}, like
 * Signal's sticker creator.
 */
export function validateImage(file: string, bytes: Uint8Array): ValidationIssue[] {
	const { maxBytes } = STICKER_LIMITS;
	const issues: ValidationIssue[] = [];
	const info = readImageInfo(bytes);
	const sizeRule = info && brokenSizeRule(info);
	if (!info) {
		issues.push({ code: "unsupportedFormat", file, message: `${file} is not a PNG or WebP image` });
	} else if (sizeRule !== undefined) {
		issues.push({
			code: "wrongSize",
			file,
			message: `${file} is ${info.width}x${info.height} pixels; ${sizeRule}`,
		});
	}
	if (info?.plays !== undefined && info.plays !== 0) {
		issues.push({ code: "mustLoopForever", file, message: `${file} must loop forever` });
	}
	if (bytes.length > maxBytes) {
		issues.push({
			code: "tooLarge",
			file,
			message: `${file} is ${kibibytes(bytes.length)} KiB; stickers must be at most ${kibibytes(maxBytes)} KiB`,
		});
	}
	return issues;
}

/**
 * Checks a pack for push: title, author, sticker count, an emoji per sticker, and every image it
 * names, the cover included. `images` maps file names to their bytes; a missing entry is reported.
 */
export function validatePack(
	pack: Pack,
	images: ReadonlyMap<string, Uint8Array>,
): ValidationIssue[] {
	const { minStickers, maxStickers } = STICKER_LIMITS;
	const issues: ValidationIssue[] = [];
	if (pack.title.trim() === "") {
		issues.push({ code: "missingTitle", message: "The pack needs a title" });
	}
	if (pack.author.trim() === "") {
		issues.push({ code: "missingAuthor", message: "The pack needs an author" });
	}
	if (pack.stickers.length < minStickers) {
		issues.push({
			code: "tooFewStickers",
			message: `The pack needs at least ${minStickers} sticker`,
		});
	}
	if (pack.stickers.length > maxStickers) {
		issues.push({
			code: "tooManyStickers",
			message: `The pack has ${pack.stickers.length} stickers; the limit is ${maxStickers}`,
		});
	}
	for (const { file, emoji } of pack.stickers) {
		if (emoji === undefined || emoji === "") {
			issues.push({ code: "missingEmoji", file, message: `${file} needs an emoji` });
		}
	}
	for (const file of packImageFiles(pack)) {
		const bytes = images.get(file);
		if (bytes) {
			issues.push(...validateImage(file, bytes));
		} else {
			issues.push({ code: "missingImage", file, message: `${file} is missing` });
		}
	}
	return issues;
}

/** The distinct image files `pack` names: its stickers' and the cover. */
export function packImageFiles(pack: Pack): string[] {
	return [...new Set([...pack.stickers.map(({ file }) => file), pack.cover])];
}

const PNG_SIGNATURE_SIZE = 8;
const PNG_CHUNK_HEADER_SIZE = 8;
const PNG_CHUNK_CRC_SIZE = 4;

/** Reads IHDR, and the play count of an APNG. */
function readPngInfo(bytes: Uint8Array): ImageInfo | undefined {
	const view = dataView(bytes);
	const ihdr = PNG_SIGNATURE_SIZE + PNG_CHUNK_HEADER_SIZE;
	if (bytes.length < ihdr + 8 || fourCc(bytes, PNG_SIGNATURE_SIZE + 4) !== "IHDR") {
		return undefined;
	}
	const plays = readApngPlays(bytes, view);
	return { format: "png", width: view.getUint32(ihdr), height: view.getUint32(ihdr + 4), plays };
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourCc(bytes: Uint8Array, offset: number): string {
	return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

/**
 * Like Signal's `getAnimatedPngDataIfExists`: an `acTL` chunk before the first `IDAT` marks an APNG,
 * and its `num_plays` follows `num_frames`.
 */
function readApngPlays(bytes: Uint8Array, view: DataView): number | undefined {
	let offset = PNG_SIGNATURE_SIZE;
	while (offset + PNG_CHUNK_HEADER_SIZE <= bytes.length) {
		const type = fourCc(bytes, offset + 4);
		if (type === "acTL") {
			const plays = offset + PNG_CHUNK_HEADER_SIZE + 4;
			return plays + 4 <= bytes.length ? view.getUint32(plays) : undefined;
		}
		if (type === "IDAT") {
			return undefined;
		}
		offset += PNG_CHUNK_HEADER_SIZE + view.getUint32(offset) + PNG_CHUNK_CRC_SIZE;
	}
	return undefined;
}

const WEBP_CHUNK = 20;
const VP8_START_CODE = [0x9d, 0x01, 0x2a];
const VP8L_SIGNATURE = 0x2f;

/** Reads the first chunk after the RIFF header: lossy `VP8 `, lossless `VP8L`, or extended `VP8X`. */
function readWebpInfo(bytes: Uint8Array): ImageInfo | undefined {
	const view = dataView(bytes);
	switch (fourCc(bytes, 12)) {
		case "VP8 ":
			// A 3-byte frame tag and the start code precede two 14-bit dimensions.
			if (
				bytes.length < WEBP_CHUNK + 10 ||
				!VP8_START_CODE.every((byte, i) => bytes[WEBP_CHUNK + 3 + i] === byte)
			) {
				return undefined;
			}
			return webpInfo(
				view.getUint16(WEBP_CHUNK + 6, true) & 0x3fff,
				view.getUint16(WEBP_CHUNK + 8, true) & 0x3fff,
			);
		case "VP8L": {
			// The signature precedes 14-bit width and height, each stored minus one.
			if (bytes.length < WEBP_CHUNK + 5 || bytes[WEBP_CHUNK] !== VP8L_SIGNATURE) {
				return undefined;
			}
			const bits = view.getUint32(WEBP_CHUNK + 1, true);
			return webpInfo((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
		}
		case "VP8X": {
			// Flags and 3 reserved bytes precede 24-bit canvas width and height, each minus one.
			if (bytes.length < WEBP_CHUNK + 10) {
				return undefined;
			}
			const uint24 = (offset: number) =>
				view.getUint16(offset, true) + (view.getUint8(offset + 2) << 16);
			return webpInfo(uint24(WEBP_CHUNK + 4) + 1, uint24(WEBP_CHUNK + 7) + 1);
		}
		default:
			return undefined;
	}
}

function webpInfo(width: number, height: number): ImageInfo {
	return { format: "webp", width, height };
}

/** Signal's creator uploads APNGs unchanged and turns other images into 512x512 WebP. */
function brokenSizeRule({ width, height, plays }: ImageInfo): string | undefined {
	const { size, minAnimatedSize } = STICKER_LIMITS;
	if (plays === undefined) {
		return width === size && height === size ? undefined : `stickers must be ${size}x${size}`;
	}
	return width === height && width >= minAnimatedSize && width <= size
		? undefined
		: `animated stickers must be square, from ${minAnimatedSize}x${minAnimatedSize} to ${size}x${size}`;
}

function kibibytes(bytes: number): number {
	return Math.ceil(bytes / 1024);
}
