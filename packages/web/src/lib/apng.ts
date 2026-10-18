import UPNG from "upng-js";

import type { StickerLimits } from "./api.ts";

/** A frame and how long it shows, in milliseconds. */
export type TimedFrame<T> = Readonly<{ image: T; duration: number }>;

/** One encoding tried while fitting an animation in the byte limit. */
export type FitAttempt = Readonly<{ size: number; colors: number; frames: number }>;

/** Encodes RGBA frames of a `size` square as a looping APNG with at most `colors` colors. */
export type ApngEncoder = (
	frames: ArrayBuffer[],
	size: number,
	colors: number,
	durations: readonly number[],
) => Uint8Array<ArrayBuffer>;

export type FitAnimationOptions<T> = Readonly<{
	frames: readonly TimedFrame<T>[];
	/** Square sizes to try, largest first. */
	sizes: readonly number[];
	maxBytes: number;
	/** Draws each image as RGBA pixels on a transparent `size` square. */
	render: (images: readonly T[], size: number) => Promise<ArrayBuffer[]>;
	encode?: ApngEncoder;
	onAttempt?: (attempt: FitAttempt) => void;
}>;

/** The most frames decoded; longer animations keep every second, fourth, … frame. */
const MAX_FRAMES = 100;
const [MOST_COLORS, ...FEWER_COLORS] = [256, 128, 64] as const;
const SMALLER_SIZES = [448, 384, 320, 256, 192, 160, 128];
/** Sizes below this are tried only after fewer colors and frames. */
const PREFERRED_MIN_SIZE = 256;

/**
 * The square sizes to try for an animation, largest first: its longer side, within Signal's
 * animated sticker sizes, then the smaller of {@link SMALLER_SIZES}.
 */
export function fittingSizes(
	{ width, height }: Readonly<{ width: number; height: number }>,
	{ size, minAnimatedSize }: Pick<StickerLimits, "size" | "minAnimatedSize">,
): number[] {
	const largest = Math.min(size, Math.max(minAnimatedSize, width, height));
	return [largest, ...SMALLER_SIZES.filter((smaller) => smaller < largest)];
}

/**
 * Encodes `frames` as an APNG that loops forever and fits in `maxBytes`. Tries each size down to
 * {@link PREFERRED_MIN_SIZE} with 256 colors, then fewer colors, then drops every other frame while
 * more than two remain, and only then the smaller sizes. Resolves `undefined` when nothing fits.
 */
export function fitAnimation<T>(
	options: FitAnimationOptions<T>,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
	return encodeFirstFitting(fittingPlan(options.frames, options.sizes), options);
}

/** Keeps the first of every `step` frames, showing it for the whole group's duration. */
export function dropFrames<T>(frames: readonly TimedFrame<T>[], step: number): TimedFrame<T>[] {
	const kept: TimedFrame<T>[] = [];
	for (const [i, { image, duration }] of frames.entries()) {
		const group = kept.at(-1);
		if (i % step === 0 || group === undefined) {
			kept.push({ image, duration });
		} else {
			kept[kept.length - 1] = { image: group.image, duration: group.duration + duration };
		}
	}
	return kept;
}

/**
 * The smallest power of two `step` for which keeping every `step`th frame leaves at most
 * {@link MAX_FRAMES}.
 */
export function frameStep(frameCount: number): number {
	let step = 1;
	while (Math.ceil(frameCount / step) > MAX_FRAMES) {
		step *= 2;
	}
	return step;
}

/**
 * A decoded frame's duration in milliseconds, from WebCodecs' microseconds. Like browsers playing
 * GIFs, a missing duration or one of 10 ms or less shows for 100 ms.
 */
export function frameDuration(microseconds: number | null): number {
	const milliseconds = (microseconds ?? 0) / 1000;
	return milliseconds <= 10 ? 100 : milliseconds;
}

const MAX_APNG_DELAY_MS = 0xffff;

/**
 * Encodes with UPNG: palette quantization (`colors`) and frame deltas. Its `acTL` has `num_plays`
 * 0, so the animation loops forever, and each `fcTL` delay is a 16-bit count of milliseconds.
 */
export const encodeApng: ApngEncoder = (frames, size, colors, durations) => {
	const delays = durations.map((duration) => Math.min(Math.round(duration), MAX_APNG_DELAY_MS));
	return new Uint8Array(UPNG.encode(frames, size, size, colors, delays));
};

type Encoding<T> = Readonly<{ frames: readonly TimedFrame<T>[]; size: number; colors: number }>;

/** The encodings {@link fitAnimation} tries, in order. */
function fittingPlan<T>(frames: readonly TimedFrame<T>[], sizes: readonly number[]): Encoding<T>[] {
	const preferredSizes = sizes.filter((size, i) => i === 0 || size >= PREFERRED_MIN_SIZE);
	const smallest = preferredSizes.at(-1);
	if (smallest === undefined) {
		return [];
	}
	const fewestColors = FEWER_COLORS[1];
	const plan: Encoding<T>[] = preferredSizes.map((size) => ({ frames, size, colors: MOST_COLORS }));
	plan.push(...FEWER_COLORS.map((colors) => ({ frames, size: smallest, colors })));
	let kept = frames;
	while (kept.length > 2) {
		kept = dropFrames(kept, 2);
		plan.push({ frames: kept, size: smallest, colors: fewestColors });
	}
	const smallerSizes = sizes.slice(preferredSizes.length);
	plan.push(...smallerSizes.map((size) => ({ frames: kept, size, colors: fewestColors })));
	return plan;
}

/** Tries each encoding until one fits, drawing frames again only when the size or frames change. */
async function encodeFirstFitting<T>(
	[encoding, ...rest]: readonly Encoding<T>[],
	options: FitAnimationOptions<T>,
	drawn?: Readonly<{ encoding: Encoding<T>; pixels: ArrayBuffer[] }>,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
	if (!encoding) {
		return undefined;
	}
	const { frames, size, colors } = encoding;
	const { maxBytes, render, encode = encodeApng, onAttempt } = options;
	const pixels =
		drawn?.encoding.frames === frames && drawn.encoding.size === size
			? drawn.pixels
			: await render(
					frames.map(({ image }) => image),
					size,
				);
	onAttempt?.({ size, colors, frames: frames.length });
	const apng = encode(
		pixels,
		size,
		colors,
		frames.map(({ duration }) => duration),
	);
	return apng.length <= maxBytes ? apng : encodeFirstFitting(rest, options, { encoding, pixels });
}
