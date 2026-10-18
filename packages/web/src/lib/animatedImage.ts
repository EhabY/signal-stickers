import type { StickerLimits } from "./api.ts";

/** The MIME type of an image that animates: a GIF, a WebP, or an APNG. */
export type AnimationType = "image/gif" | "image/webp" | "image/png";

/**
 * Detects an animated image from its bytes: a GIF with more than one frame, a WebP with the `VP8X`
 * animation flag and more than one `ANMF` frame, or a PNG with an `acTL` chunk before `IDAT`, which
 * Signal treats as an APNG.
 */
export function sniffAnimation(bytes: Uint8Array): AnimationType | undefined {
	if (startsWith(bytes, GIF) && countGifFrames(bytes, 2) > 1) {
		return "image/gif";
	}
	if (hasWebpAnimationFlag(bytes) && countWebpFrames(bytes, 2) > 1) {
		return "image/webp";
	}
	return readApng(bytes) ? "image/png" : undefined;
}

/**
 * Whether a WebP's `VP8X` header sets the animation flag, which encoders also set on a single frame
 * that {@link sniffAnimation} counts as a still image.
 */
export function hasWebpAnimationFlag(bytes: Uint8Array): boolean {
	return (
		startsWith(bytes, RIFF) &&
		startsWith(bytes.subarray(8), WEBP_VP8X) &&
		(byteAt(bytes, VP8X_FLAGS) & VP8X_ANIMATION_FLAG) !== 0
	);
}

/**
 * Whether Signal takes this APNG unchanged, like its sticker creator: square, from
 * `minAnimatedSize` to `size` pixels, looping forever, and within `maxBytes`.
 */
export function isReadyApng(
	bytes: Uint8Array,
	{ size, minAnimatedSize, maxBytes }: StickerLimits,
): boolean {
	const apng = readApng(bytes);
	return (
		apng !== undefined &&
		apng.width === apng.height &&
		apng.width >= minAnimatedSize &&
		apng.width <= size &&
		apng.plays === 0 &&
		bytes.length <= maxBytes
	);
}

const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_VP8X = [0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58];
const VP8X_FLAGS = 20;
const VP8X_ANIMATION_FLAG = 0x02;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[i] === byte);
}

function byteAt(bytes: Uint8Array, offset: number): number {
	return bytes[offset] ?? 0;
}

const GIF_SCREEN_FLAGS = 10;
const GIF_HEADER_SIZE = 13;
const GIF_IMAGE = 0x2c;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE_FLAGS = 9;

/** Counts image descriptors, up to `limit`, skipping color tables and data sub-blocks. */
function countGifFrames(bytes: Uint8Array, limit: number): number {
	let offset = GIF_HEADER_SIZE + colorTableSize(byteAt(bytes, GIF_SCREEN_FLAGS));
	let frames = 0;
	while (offset < bytes.length && frames < limit) {
		const block = byteAt(bytes, offset);
		if (block === GIF_IMAGE) {
			frames += 1;
			// The descriptor and its color table precede the LZW code size and the data.
			const data = offset + 10 + colorTableSize(byteAt(bytes, offset + GIF_IMAGE_FLAGS)) + 1;
			offset = skipSubBlocks(bytes, data);
		} else if (block === GIF_EXTENSION) {
			offset = skipSubBlocks(bytes, offset + 2);
		} else {
			break;
		}
	}
	return frames;
}

function colorTableSize(flags: number): number {
	return (flags & 0x80) === 0 ? 0 : 3 * 2 ** ((flags & 0x07) + 1);
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
	let next = offset;
	while (next < bytes.length && byteAt(bytes, next) !== 0) {
		next += byteAt(bytes, next) + 1;
	}
	return next + 1;
}

const RIFF_HEADER_SIZE = 12;
const RIFF_CHUNK_HEADER_SIZE = 8;

/** Like core's `readImageInfo`: counts `ANMF` chunks, up to `limit`. */
function countWebpFrames(bytes: Uint8Array, limit: number): number {
	const view = dataView(bytes);
	let offset = RIFF_HEADER_SIZE;
	let frames = 0;
	while (frames < limit && offset + RIFF_CHUNK_HEADER_SIZE <= bytes.length) {
		if (fourCc(bytes, offset) === "ANMF") {
			frames += 1;
		}
		const size = view.getUint32(offset + 4, true);
		// RIFF pads a chunk of odd size with a byte.
		offset += RIFF_CHUNK_HEADER_SIZE + size + (size % 2);
	}
	return frames;
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourCc(bytes: Uint8Array, offset: number): string {
	return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

const PNG_CHUNK_HEADER_SIZE = 8;
const PNG_CHUNK_CRC_SIZE = 4;

/** Like core's `readImageInfo`: IHDR's size, and `num_plays` from an `acTL` before `IDAT`. */
function readApng(bytes: Uint8Array): { width: number; height: number; plays: number } | undefined {
	if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24) {
		return undefined;
	}
	const view = dataView(bytes);
	let offset = PNG_SIGNATURE.length;
	while (offset + PNG_CHUNK_HEADER_SIZE <= bytes.length) {
		const type = fourCc(bytes, offset + 4);
		if (type === "acTL") {
			const plays = offset + PNG_CHUNK_HEADER_SIZE + 4;
			return plays + 4 <= bytes.length
				? { width: view.getUint32(16), height: view.getUint32(20), plays: view.getUint32(plays) }
				: undefined;
		}
		if (type === "IDAT") {
			return undefined;
		}
		offset += PNG_CHUNK_HEADER_SIZE + view.getUint32(offset) + PNG_CHUNK_CRC_SIZE;
	}
	return undefined;
}
