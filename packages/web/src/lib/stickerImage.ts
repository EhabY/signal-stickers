import type { StickerLimits } from "./api.ts";

/** Turns any image the browser can decode into one that meets Signal's sticker limits. */
export type StickerEncoder = (image: Blob, limits: StickerLimits) => Promise<Blob>;

export class StickerImageError extends Error {
	override name = "StickerImageError";
}

/**
 * Keeps PNG and WebP images that already fit, so animations survive; otherwise draws the image
 * centered on a transparent square canvas and encodes it as WebP, lowering the quality until it fits.
 */
export const encodeSticker: StickerEncoder = async (image, { size, maxBytes }) => {
	const bitmap = await createImageBitmap(image).catch((error: unknown) => {
		throw new StickerImageError("The browser cannot read this image", { cause: error });
	});
	try {
		const fits = bitmap.width === size && bitmap.height === size && image.size <= maxBytes;
		if (fits && (image.type === "image/png" || image.type === "image/webp")) {
			return image;
		}
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new StickerImageError("The browser cannot draw images");
		}
		const { x, y, width, height } = fitInSquare(bitmap, size);
		context.drawImage(bitmap, x, y, width, height);
		return await encodeWithinLimit((quality) => toWebp(canvas, quality), maxBytes);
	} finally {
		bitmap.close();
	}
};

export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Scales `image` to fit a `size` square, centered, keeping its aspect ratio. */
export function fitInSquare(
	image: Readonly<{ width: number; height: number }>,
	size: number,
): Rect {
	const scale = size / Math.max(image.width, image.height);
	const width = Math.round(image.width * scale);
	const height = Math.round(image.height * scale);
	return { x: Math.floor((size - width) / 2), y: Math.floor((size - height) / 2), width, height };
}

/** Encodes at falling qualities until the result fits in `maxBytes`. */
export async function encodeWithinLimit(
	encode: (quality: number) => Promise<Blob>,
	maxBytes: number,
	qualities: readonly number[] = [0.9, 0.8, 0.7, 0.55, 0.4, 0.25],
): Promise<Blob> {
	const [quality, ...lower] = qualities;
	if (quality === undefined) {
		throw new StickerImageError(`The image does not fit in ${Math.floor(maxBytes / 1024)} KiB`);
	}
	const blob = await encode(quality);
	if (blob.size <= maxBytes) {
		return blob;
	}
	// Browsers without a WebP encoder fall back to lossless PNG, which ignores the quality.
	return encodeWithinLimit(encode, maxBytes, blob.type === "image/webp" ? lower : []);
}

function toWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	const { promise, resolve, reject } = Promise.withResolvers<Blob>();
	canvas.toBlob(
		(blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new StickerImageError("Could not encode the image"));
			}
		},
		"image/webp",
		quality,
	);
	return promise;
}
