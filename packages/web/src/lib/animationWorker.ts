import apngJs from "apng-js";
import { decompressFrame, parseGIF } from "gifuct-js";

import type { AnimationType } from "./animatedImage.ts";
import {
	serveConversions,
	type AnimationDecoder,
	type OpenDecoder,
} from "./animationConversion.ts";
import { fitInSquare } from "./square.ts";
import { splitWebp } from "./webpFrames.ts";

const openAnimation: OpenDecoder<ImageBitmap> = (bytes, type) =>
	Promise.resolve(
		typeof OffscreenCanvas === "undefined" ? undefined : compositor(PATCH_READERS[type](bytes)),
	);

serveConversions(self, openAnimation);

type PatchedAnimation = Readonly<{
	width: number;
	height: number;
	frameCount: number;
	patchAt(index: number): FramePatch;
}>;

/** A frame's own pixels and how they composite over the frames before it. */
type FramePatch = Readonly<{
	image: ImageBitmapSource;
	x: number;
	y: number;
	width: number;
	height: number;
	/** In milliseconds. */
	duration: number;
	/** Whether the patch draws over its area or replaces it. */
	blend: boolean;
	disposal: "keep" | "clear" | "restore";
}>;

const GIF_DISPOSALS: Partial<Record<number, FramePatch["disposal"]>> = { 2: "clear", 3: "restore" };
const APNG_DISPOSALS: Partial<Record<number, FramePatch["disposal"]>> = {
	1: "clear",
	2: "restore",
};
const APNG_BLEND_OVER = 1;

const PATCH_READERS: Record<AnimationType, (bytes: ArrayBuffer) => PatchedAnimation> = {
	"image/gif": (bytes) => {
		const gif = parseGIF(bytes);
		const frames = gif.frames.filter((block) => "image" in block);
		return {
			width: gif.lsd.width,
			height: gif.lsd.height,
			frameCount: frames.length,
			patchAt(index) {
				const { dims, patch, delay, disposalType } = decompressFrame(
					frameAt(frames, index),
					gif.gct,
					true,
				);
				const image = new ImageData(dims.width, dims.height);
				image.data.set(patch);
				return {
					image,
					x: dims.left,
					y: dims.top,
					width: dims.width,
					height: dims.height,
					// Unset, despite the types, without a graphic control extension.
					duration: delay || 0,
					blend: true,
					disposal: GIF_DISPOSALS[disposalType] ?? "keep",
				};
			},
		};
	},
	"image/png": (bytes) => {
		const apng = apngJs.default(bytes);
		if (apng instanceof Error) {
			throw apng;
		}
		return {
			width: apng.width,
			height: apng.height,
			frameCount: apng.frames.length,
			patchAt(index) {
				const frame = frameAt(apng.frames, index);
				if (!frame.imageData) {
					throw new Error(`APNG frame ${index} has no image`);
				}
				return {
					image: frame.imageData,
					x: frame.left,
					y: frame.top,
					width: frame.width,
					height: frame.height,
					duration: frame.delay,
					blend: frame.blendOp === APNG_BLEND_OVER,
					disposal: APNG_DISPOSALS[frame.disposeOp] ?? "keep",
				};
			},
		};
	},
	"image/webp": (bytes) => {
		const { width, height, frames } = splitWebp(new Uint8Array(bytes));
		return {
			width,
			height,
			frameCount: frames.length,
			patchAt(index) {
				const { image, ...frame } = frameAt(frames, index);
				return { ...frame, image: new Blob([image], { type: "image/webp" }) };
			},
		};
	},
};

const keepFrame = (): void => {};

/** Draws frames in order, each over what the frames before it left. */
function compositor({
	width,
	height,
	frameCount,
	patchAt,
}: PatchedAnimation): AnimationDecoder<ImageBitmap> {
	const { canvas, context } = canvas2d(width, height);
	const bitmaps: ImageBitmap[] = [];
	let dispose = keepFrame;
	let next = 0;
	return {
		width,
		height,
		frameCount,
		async decode(index, size) {
			if (index !== next) {
				throw new Error(`Frame ${index} decoded out of order`);
			}
			next += 1;
			dispose();
			const patch = patchAt(index);
			dispose = await drawPatch(context, patch);
			if (size === undefined) {
				return { duration: patch.duration };
			}
			const image = drawFitted(canvas, size);
			bitmaps.push(image);
			return { duration: patch.duration, image };
		},
		render: (images, size) => Promise.resolve(rgbaPixels(images, size)),
		close() {
			for (const bitmap of bitmaps) {
				bitmap.close();
			}
		},
	};
}

/** Resolves how to dispose of the patch before the next frame. */
async function drawPatch(
	context: OffscreenCanvasRenderingContext2D,
	{ image, x, y, width, height, blend, disposal }: FramePatch,
): Promise<() => void> {
	const previous = disposal === "restore" ? context.getImageData(x, y, width, height) : undefined;
	const bitmap = await createImageBitmap(image);
	if (!blend) {
		context.clearRect(x, y, width, height);
	}
	context.drawImage(bitmap, x, y);
	bitmap.close();
	if (previous) {
		return () => {
			context.putImageData(previous, x, y);
		};
	}
	return disposal === "clear"
		? () => {
				context.clearRect(x, y, width, height);
			}
		: keepFrame;
}

function frameAt<T>(frames: readonly T[], index: number): T {
	const frame = frames[index];
	if (frame === undefined) {
		throw new RangeError(`The animation has no frame ${index}`);
	}
	return frame;
}

function drawFitted(source: OffscreenCanvas, size: number): ImageBitmap {
	const { canvas, context } = canvas2d(size, size);
	const { x, y, width, height } = fitInSquare(source, size);
	context.drawImage(source, x, y, width, height);
	return canvas.transferToImageBitmap();
}

function rgbaPixels(images: readonly ImageBitmap[], size: number): ArrayBuffer[] {
	const { context } = canvas2d(size, size, { willReadFrequently: true });
	return images.map((image) => {
		context.clearRect(0, 0, size, size);
		context.drawImage(image, 0, 0, size, size);
		return context.getImageData(0, 0, size, size).data.buffer;
	});
}

/** The default smoothing quality aliases when shrinking a lot. */
function canvas2d(
	width: number,
	height: number,
	settings?: CanvasRenderingContext2DSettings,
): Readonly<{ canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D }> {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d", settings);
	if (!context) {
		throw new Error("The browser cannot draw images");
	}
	context.imageSmoothingQuality = "high";
	return { canvas, context };
}
