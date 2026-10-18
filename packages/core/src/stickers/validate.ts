import { readImageInfo, type ImageInfo } from "./image.ts";
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
	| "tooLarge"
	| "duplicateImage";

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

/**
 * Checks one image's format, size, looping, and byte length against {@link STICKER_LIMITS}, like
 * Signal's sticker creator.
 */
export function validateImage(file: string, bytes: Uint8Array): ValidationIssue[] {
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
	if (bytes.length > STICKER_LIMITS.maxBytes) {
		issues.push(tooLarge(file, bytes.length));
	}
	return issues;
}

/**
 * Checks a pack for push: title, author, sticker count, an emoji per sticker, every image it names
 * (the cover included), and that no two stickers share an image. `images` maps file names to their
 * bytes, and `oversizedImages` to the length of those too large to read; others are missing.
 */
export function validatePack(
	pack: Pack,
	images: ReadonlyMap<string, Uint8Array>,
	oversizedImages: ReadonlyMap<string, number> = new Map(),
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
		const oversizedLength = oversizedImages.get(file);
		if (bytes) {
			issues.push(...validateImage(file, bytes));
		} else if (oversizedLength === undefined) {
			issues.push({ code: "missingImage", file, message: `${file} is missing` });
		} else {
			issues.push(tooLarge(file, oversizedLength));
		}
	}
	issues.push(...findDuplicateImages(pack, images));
	return issues;
}

/** The distinct image files `pack` names: its stickers' and the cover. */
export function packImageFiles(pack: Pack): string[] {
	return [...new Set([...pack.stickers.map(({ file }) => file), pack.cover])];
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

function tooLarge(file: string, length: number): ValidationIssue {
	const limit = kibibytes(STICKER_LIMITS.maxBytes);
	const message = `${file} is ${kibibytes(length)} KiB; stickers must be at most ${limit} KiB`;
	return { code: "tooLarge", file, message };
}

function kibibytes(bytes: number): number {
	return Math.ceil(bytes / 1024);
}

/** Reports stickers whose image repeats an earlier sticker's; the cover may repeat one. */
function findDuplicateImages(
	pack: Pack,
	images: ReadonlyMap<string, Uint8Array>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const files = new Set<string>();
	const repeatedFiles = new Set<string>();
	const distinct: { file: string; bytes: Uint8Array }[] = [];
	for (const { file } of pack.stickers) {
		const bytes = images.get(file);
		if (files.has(file)) {
			repeatedFiles.add(file);
		} else if (bytes) {
			const original = distinct.find((image) => equalBytes(image.bytes, bytes));
			if (original) {
				issues.push(duplicateImage(file, `${file} is the same image as ${original.file}`));
			} else {
				distinct.push({ file, bytes });
			}
		}
		files.add(file);
	}
	for (const file of repeatedFiles) {
		issues.push(duplicateImage(file, `${file} is used by more than one sticker`));
	}
	return issues;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function duplicateImage(file: string, problem: string): ValidationIssue {
	return { code: "duplicateImage", file, message: `${problem}; each sticker needs its own image` };
}
