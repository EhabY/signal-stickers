import { createHash } from "node:crypto";

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
	| "unsupportedAnimation"
	| "tooLarge"
	| "duplicateImage";

/** An image too large to read whole: its byte length, and whether it is an animated WebP. */
export type OversizedImage = Readonly<{ length: number; animated: boolean }>;

/** What validating a pack needs from one image: its own issues, and a digest to find duplicates. */
export type ImageCheck = Readonly<{
	issues: readonly ValidationIssue[];
	/** The image's SHA-256, unless it was too large to read. */
	digest?: string | undefined;
}>;

/** An error stops a push; a warning tells what Signal will do differently. */
export type IssueSeverity = "error" | "warning";

/** A problem with a pack. `file` names the image for per-sticker issues. */
export type ValidationIssue = Readonly<{
	code: ValidationCode;
	severity: IssueSeverity;
	message: string;
	file?: string | undefined;
}>;

/** Refuses a push; `issues` holds only the errors. */
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
		issues.push({
			code: "unsupportedFormat",
			severity: "error",
			file,
			message: `${file} is not a PNG or WebP image`,
		});
	} else if (info.animated) {
		issues.push(unsupportedAnimation(file));
	} else if (sizeRule !== undefined) {
		issues.push({
			code: "wrongSize",
			severity: "error",
			file,
			message: `${file} is ${info.width}x${info.height} pixels; ${sizeRule}`,
		});
	}
	if (info?.plays !== undefined && info.plays !== 0) {
		issues.push({
			code: "mustLoopForever",
			severity: "error",
			file,
			message: `${file} must loop forever`,
		});
	}
	if (bytes.length > STICKER_LIMITS.maxBytes) {
		issues.push(tooLarge(file, bytes.length));
	}
	return issues;
}

/** Checks an image read whole with {@link validateImage}. */
export function checkImage(file: string, bytes: Uint8Array): ImageCheck {
	const digest = createHash("sha256").update(bytes).digest("hex");
	return { issues: validateImage(file, bytes), digest };
}

/** Checks an image too large to read whole by what its headers tell. */
export function checkOversizedImage(
	file: string,
	{ length, animated }: OversizedImage,
): ImageCheck {
	return { issues: [...(animated ? [unsupportedAnimation(file)] : []), tooLarge(file, length)] };
}

/**
 * Checks a pack for push: title, author, sticker count, every image it names (the cover included),
 * and that no two stickers share an image. A sticker without an emoji is only a warning. `checks`
 * maps file names to their images' checks; images without one are missing.
 */
export function validatePack(
	pack: Pack,
	checks: ReadonlyMap<string, ImageCheck>,
): ValidationIssue[] {
	const { minStickers, maxStickers } = STICKER_LIMITS;
	const issues: ValidationIssue[] = [];
	if (pack.title.trim() === "") {
		issues.push({ code: "missingTitle", severity: "error", message: "The pack needs a title" });
	}
	if (pack.author.trim() === "") {
		issues.push({ code: "missingAuthor", severity: "error", message: "The pack needs an author" });
	}
	if (pack.stickers.length < minStickers) {
		issues.push({
			code: "tooFewStickers",
			severity: "error",
			message: `The pack needs at least ${minStickers} sticker`,
		});
	}
	if (pack.stickers.length > maxStickers) {
		issues.push({
			code: "tooManyStickers",
			severity: "error",
			message: `The pack has ${pack.stickers.length} stickers; the limit is ${maxStickers}`,
		});
	}
	issues.push(...findMissingEmoji(pack));
	for (const file of packImageFiles(pack)) {
		issues.push(
			...(checks.get(file)?.issues ?? [
				{ code: "missingImage", severity: "error", file, message: `${file} is missing` },
			]),
		);
	}
	issues.push(...findDuplicateImages(pack, checks));
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

function unsupportedAnimation(file: string): ValidationIssue {
	const message = `${file} is an animated WebP, but Signal only animates PNG stickers. Convert it to an animated PNG in the web editor.`;
	return { code: "unsupportedAnimation", severity: "error", file, message };
}

function tooLarge(file: string, length: number): ValidationIssue {
	const limit = kibibytes(STICKER_LIMITS.maxBytes);
	const message = `${file} is ${kibibytes(length)} KiB; stickers must be at most ${limit} KiB`;
	return { code: "tooLarge", severity: "error", file, message };
}

function kibibytes(bytes: number): number {
	return Math.ceil(bytes / 1024);
}

/** Signal suggests stickers by emoji while typing, so a sticker without one is never suggested. */
function findMissingEmoji(pack: Pack): ValidationIssue[] {
	return pack.stickers
		.filter(({ emoji }) => emoji === undefined || emoji === "")
		.map(({ file }) => ({
			code: "missingEmoji",
			severity: "warning",
			file,
			message: `${file} has no emoji, so Signal won't suggest it while typing`,
		}));
}

/** Reports stickers whose image repeats an earlier sticker's; the cover may repeat one. */
function findDuplicateImages(
	pack: Pack,
	checks: ReadonlyMap<string, ImageCheck>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const files = new Set<string>();
	const repeatedFiles = new Set<string>();
	const firstFileByDigest = new Map<string, string>();
	for (const { file } of pack.stickers) {
		const digest = checks.get(file)?.digest;
		if (files.has(file)) {
			repeatedFiles.add(file);
		} else if (digest !== undefined) {
			const original = firstFileByDigest.get(digest);
			if (original === undefined) {
				firstFileByDigest.set(digest, file);
			} else {
				issues.push(duplicateImage(file, `${file} is the same image as ${original}`));
			}
		}
		files.add(file);
	}
	for (const file of repeatedFiles) {
		issues.push(duplicateImage(file, `${file} is used by more than one sticker`));
	}
	return issues;
}

function duplicateImage(file: string, problem: string): ValidationIssue {
	const message = `${problem}; each sticker needs its own image`;
	return { code: "duplicateImage", severity: "error", file, message };
}
