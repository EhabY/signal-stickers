import type { AnimationType } from "./animatedImage.ts";
import { errorMessage, type StickerLimits } from "./api.ts";
import {
	dropFrames,
	fitAnimation,
	fittingSizes,
	frameDuration,
	frameStep,
	type FitAttempt,
	type TimedFrame,
} from "./apng.ts";

/** What the page asks the conversion worker. */
export type ConversionRequest = Readonly<{
	bytes: ArrayBuffer;
	type: AnimationType;
	limits: StickerLimits;
}>;

export type ConversionProgress =
	| Readonly<{ step: "decode"; done: number; total: number }>
	| Readonly<{ step: "encode" } & FitAttempt>;

/**
 * What the worker answers: progress, then an APNG, `still` for a single frame, `unsupported` when
 * the browser cannot decode the type, or an error.
 */
export type ConversionMessage =
	| Readonly<{ type: "progress"; progress: ConversionProgress }>
	| Readonly<{ type: "done"; apng: ArrayBuffer }>
	| Readonly<{ type: "still" }>
	| Readonly<{ type: "unsupported" }>
	| Readonly<{ type: "error"; message: string }>;

/** An animation being decoded, with its frames drawn into images of type `T`. */
export type AnimationDecoder<T> = Readonly<{
	width: number;
	height: number;
	frameCount: number;
	/**
	 * Decodes frame `index` for its duration in microseconds, and draws it fitted in a transparent
	 * `size` square if `size` is set.
	 */
	decode(index: number, size?: number): Promise<{ duration: number | null; image?: T }>;
	/** Draws each image as RGBA pixels on a transparent `size` square. */
	render(images: readonly T[], size: number): Promise<ArrayBuffer[]>;
	close(): void;
}>;

/** Opens an animation, or resolves `undefined` if the browser cannot decode its type. */
export type OpenDecoder<T> = (
	bytes: ArrayBuffer,
	type: AnimationType,
) => Promise<AnimationDecoder<T> | undefined>;

/** The worker's side of the message channel: the dedicated worker's global scope. */
export type ConversionScope = Readonly<{
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<ConversionRequest>) => void,
	): void;
	postMessage(message: ConversionMessage, options: { transfer: Transferable[] }): void;
}>;

/** Answers each request on `scope` with progress messages and then the result. */
export function serveConversions<T>(scope: ConversionScope, open: OpenDecoder<T>): void {
	scope.addEventListener("message", ({ data }) => {
		void answer(scope, data, open);
	});
}

async function answer<T>(
	scope: ConversionScope,
	request: ConversionRequest,
	open: OpenDecoder<T>,
): Promise<void> {
	const message = await convertAnimation(request, open, (progress) => {
		scope.postMessage({ type: "progress", progress }, { transfer: [] });
	});
	scope.postMessage(message, { transfer: message.type === "done" ? [message.apng] : [] });
}

/** Decodes an animation and encodes it as an APNG that Signal accepts. */
async function convertAnimation<T>(
	{ bytes, type, limits }: ConversionRequest,
	open: OpenDecoder<T>,
	onProgress: (progress: ConversionProgress) => void,
): Promise<ConversionMessage> {
	try {
		const decoder = await open(bytes, type);
		if (!decoder) {
			return { type: "unsupported" };
		}
		try {
			return await encodeFrames(decoder, limits, onProgress);
		} finally {
			decoder.close();
		}
	} catch (error) {
		return { type: "error", message: `Could not convert the animation: ${errorMessage(error)}` };
	}
}

async function encodeFrames<T>(
	decoder: AnimationDecoder<T>,
	limits: StickerLimits,
	onProgress: (progress: ConversionProgress) => void,
): Promise<ConversionMessage> {
	if (decoder.frameCount < 2) {
		return { type: "still" };
	}
	const sizes = fittingSizes(decoder, limits);
	const apng = await fitAnimation({
		frames: await decodeFrames(decoder, sizes[0] ?? limits.size, onProgress),
		sizes,
		maxBytes: limits.maxBytes,
		render: (images, size) => decoder.render(images, size),
		onAttempt: (attempt) => {
			onProgress({ step: "encode", ...attempt });
		},
	});
	if (!apng) {
		const kib = Math.floor(limits.maxBytes / 1024);
		const message = `The animation does not fit in ${kib} KiB, even smaller and with fewer colors and frames. Shorten or simplify it and try again.`;
		return { type: "error", message };
	}
	return { type: "done", apng: apng.slice().buffer };
}

/**
 * Decodes every frame for its duration but, past {@link frameStep}'s limit, draws only the first of
 * each group of frames, which then shows for the whole group.
 */
async function decodeFrames<T>(
	decoder: AnimationDecoder<T>,
	size: number,
	onProgress: (progress: ConversionProgress) => void,
): Promise<TimedFrame<T>[]> {
	const { frameCount } = decoder;
	const step = frameStep(frameCount);
	const frames: TimedFrame<T>[] = [];
	const decodeFrom = async (index: number): Promise<void> => {
		const draws = index % step === 0;
		const { duration, image = frames.at(-1)?.image } = await decoder.decode(
			index,
			draws ? size : undefined,
		);
		if (image !== undefined) {
			frames.push({ image, duration: frameDuration(duration) });
		}
		onProgress({ step: "decode", done: index + 1, total: frameCount });
		return index + 1 < frameCount ? decodeFrom(index + 1) : undefined;
	};
	await decodeFrom(0);
	return dropFrames(frames, step);
}
