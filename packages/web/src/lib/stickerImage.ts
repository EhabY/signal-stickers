import { hasWebpAnimationFlag, isReadyApng, sniffAnimation } from "./animatedImage.ts";
import type {
	ConversionMessage,
	ConversionProgress,
	ConversionRequest,
} from "./animationConversion.ts";
import type { StickerLimits } from "./api.ts";
import { fitInSquare } from "./square.ts";

/** Turns any image the browser can decode into one that meets Signal's sticker limits. */
export type StickerEncoder = (
	image: Blob,
	limits: StickerLimits,
	options?: EncodeOptions,
) => Promise<Blob>;

export type EncodeOptions = Readonly<{
	/** Stops converting an animation, rejecting with the signal's reason. */
	signal?: AbortSignal;
	onProgress?: (progress: ConversionProgress) => void;
	/** Called when the browser cannot convert an animated GIF or WebP, so it keeps its first frame. */
	onFlattened?: () => void;
}>;

export const CANNOT_CONVERT =
	"This browser cannot convert animations. Use Chrome, Edge, or Firefox, or add an animated PNG that already fits.";

export class StickerImageError extends Error {
	override name = "StickerImageError";
}

/** The conversion worker as the page sees it; a fake in tests. */
export type ConversionWorker = Readonly<{
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<ConversionMessage>) => void,
	): void;
	addEventListener(type: "error", listener: (event: Event) => void): void;
	postMessage(request: ConversionRequest, transfer: Transferable[]): void;
	terminate(): void;
}>;

/**
 * Makes an encoder that keeps still images that fit and an APNG Signal takes as it is, and converts
 * other animations (GIF, animated WebP, APNG) to APNG in a worker from `startWorker`. Like Signal's
 * creator, it draws as a still WebP any other image, a single frame animation, and a GIF or WebP
 * the browser cannot convert.
 */
export function stickerEncoder(
	startWorker: () => ConversionWorker = startModuleWorker,
): StickerEncoder {
	return async (image, limits, options = {}) => {
		const bytes = new Uint8Array(await image.arrayBuffer());
		const type = sniffAnimation(bytes);
		if (type === undefined) {
			return encodeStill(image, limits, { keepIfFits: !hasWebpAnimationFlag(bytes) });
		}
		if (type === "image/png" && isReadyApng(bytes, limits)) {
			return image;
		}
		const request = { bytes: bytes.buffer, type, limits };
		const answer = await convertInWorker(startWorker(), request, options);
		if (answer.type === "done") {
			return new Blob([answer.apng], { type: "image/png" });
		}
		if (answer.type === "unsupported") {
			if (type === "image/png") {
				throw new StickerImageError(CANNOT_CONVERT);
			}
			options.onFlattened?.();
		}
		return encodeStill(image, limits, { keepIfFits: false });
	};
}

export const encodeSticker: StickerEncoder = stickerEncoder();

/**
 * Encodes at falling qualities until the result fits in `maxBytes`. Browsers without a WebP encoder,
 * such as Safari, return lossless PNG instead, which is kept only if it fits.
 */
export async function encodeWithinLimit(
	encode: (quality: number) => Promise<Blob>,
	{ size, maxBytes }: Pick<StickerLimits, "size" | "maxBytes">,
	qualities: readonly number[] = [0.9, 0.8, 0.7, 0.55, 0.4, 0.25],
): Promise<Blob> {
	const [quality, ...lower] = qualities;
	const kib = Math.floor(maxBytes / 1024);
	if (quality === undefined) {
		throw new StickerImageError(`The image does not fit in ${kib} KiB`);
	}
	const blob = await encode(quality);
	if (blob.size <= maxBytes) {
		return blob;
	}
	if (blob.type !== "image/webp") {
		throw new StickerImageError(
			`This browser cannot convert images to WebP, and as PNG this one is over ${kib} KiB. Add a ${size}×${size} PNG or WebP image under ${kib} KiB, or use a browser that can, such as Chrome or Firefox.`,
		);
	}
	return encodeWithinLimit(encode, { size, maxBytes }, lower);
}

/** Sends `request` to `worker` and stops the worker once it answers or `signal` aborts. */
export async function convertInWorker(
	worker: ConversionWorker,
	request: ConversionRequest,
	{ signal, onProgress }: EncodeOptions = {},
): Promise<Extract<ConversionMessage, { type: "done" | "still" | "unsupported" }>> {
	const { promise, resolve, reject } =
		Promise.withResolvers<Exclude<ConversionMessage, { type: "progress" }>>();
	const abort = (): void => {
		reject(signal?.reason);
	};
	worker.addEventListener("message", ({ data }) => {
		if (data.type === "progress") {
			onProgress?.(data.progress);
		} else {
			resolve(data);
		}
	});
	worker.addEventListener("error", () => {
		reject(new StickerImageError("The browser could not start converting the animation"));
	});
	signal?.addEventListener("abort", abort);
	try {
		signal?.throwIfAborted();
		worker.postMessage(request, [request.bytes]);
		const answer = await promise;
		if (answer.type === "error") {
			throw new StickerImageError(answer.message);
		}
		return answer;
	} finally {
		signal?.removeEventListener("abort", abort);
		worker.terminate();
	}
}

function startModuleWorker(): ConversionWorker {
	return new Worker(new URL("./animationWorker.ts", import.meta.url), { type: "module" });
}

/**
 * Keeps PNG and WebP images that already fit, if `keepIfFits`; otherwise draws the image centered on
 * a transparent square canvas and encodes it as WebP, lowering the quality until it fits.
 */
async function encodeStill(
	image: Blob,
	limits: StickerLimits,
	{ keepIfFits = true } = {},
): Promise<Blob> {
	const { size, maxBytes } = limits;
	const bitmap = await createImageBitmap(image).catch((error: unknown) => {
		throw new StickerImageError("The browser cannot read this image", { cause: error });
	});
	try {
		const fits = bitmap.width === size && bitmap.height === size && image.size <= maxBytes;
		if (keepIfFits && fits && (image.type === "image/png" || image.type === "image/webp")) {
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
		return await encodeWithinLimit(
			(quality) => encodeCanvas(canvas, "image/webp", quality),
			limits,
		);
	} finally {
		bitmap.close();
	}
}

/** Encodes the canvas as `type`, which browsers that cannot encode it replace with PNG. */
export function encodeCanvas(
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number,
): Promise<Blob> {
	const { promise, resolve, reject } = Promise.withResolvers<Blob>();
	canvas.toBlob(
		(blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new StickerImageError("Could not encode the image"));
			}
		},
		type,
		quality,
	);
	return promise;
}
