import { readImageInfo } from "@signal-stickers/shared";

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
	const info = readImageInfo(bytes);
	if (info?.animated) {
		return "image/webp";
	}
	return info?.plays === undefined ? undefined : "image/png";
}

/**
 * Whether Signal takes this APNG unchanged, like its sticker creator: square, from
 * `minAnimatedSize` to `size` pixels, looping forever, and within `maxBytes`.
 */
export function isReadyApng(
	bytes: Uint8Array,
	{ size, minAnimatedSize, maxBytes }: StickerLimits,
): boolean {
	const info = readImageInfo(bytes);
	return (
		info?.plays === 0 &&
		info.width === info.height &&
		info.width >= minAnimatedSize &&
		info.width <= size &&
		bytes.length <= maxBytes
	);
}

const GIF = [0x47, 0x49, 0x46, 0x38];

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
