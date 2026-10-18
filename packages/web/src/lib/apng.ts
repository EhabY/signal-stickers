import UPNG from "upng-js";

import type { StickerLimits } from "./api.ts";

/** A frame and how long it shows, in milliseconds. */
export type TimedFrame<T> = Readonly<{ image: T; duration: number }>;

/** One encoding tried while fitting an animation in the byte limit. */
export type FitAttempt = Readonly<{ size: number; colors: number; frames: number; fps: number }>;

/** An APNG that fits, and the encoding that made it. */
export type FittedAnimation = Readonly<{ apng: Uint8Array<ArrayBuffer>; encoding: FitAttempt }>;

/** Keeps `keep` of every `of` frames. */
export type FrameShare = Readonly<{ keep: number; of: number }>;

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

/** The most frames decoded; longer animations keep this many, spread evenly. */
const MAX_FRAMES = 150;
const COLORS = [256, 128, 64] as const;
const FRAME_SHARES: readonly FrameShare[] = [
	{ keep: 1, of: 1 },
	{ keep: 2, of: 3 },
	{ keep: 1, of: 2 },
	{ keep: 1, of: 3 },
];
const SMALLER_SIZES = [448, 384, 320, 256, 192, 160, 128];
/** Sizes below this are tried only after fewer colors and frames. */
const PREFERRED_MIN_SIZE = 160;

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
 * Encodes `frames` as an APNG that loops forever and fits in `maxBytes`, keeping the frame rate as
 * long as possible. Prefers, in order: the largest size down to {@link PREFERRED_MIN_SIZE} with 256
 * colors, then with 128 and 64 colors, then all of that again keeping 2 of every 3 frames, 1 of 2,
 * and 1 of 3, then the smaller sizes, and only then fewer frames still. Resolves `undefined` when
 * nothing fits.
 */
export async function fitAnimation<T>(
	options: FitAnimationOptions<T>,
): Promise<FittedAnimation | undefined> {
	const encode = fittingEncoder(options);
	const [first, ...rest] = fittingSweeps(options.frames, options.sizes);
	const start = first?.sizes[0];
	if (!first || start === undefined) {
		return undefined;
	}
	// Most animations fit as they are, so try that before searching up from the smallest size.
	const unchanged = await encode(first.frames, first.colors, start);
	return (
		unchanged ?? encodeFirstFitting([{ ...first, sizes: first.sizes.slice(1) }, ...rest], encode)
	);
}

/**
 * Keeps `keep` of every `of` frames, spread evenly. A kept frame also shows for the time of the
 * frames dropped after it, so the animation lasts as long.
 */
export function dropFrames<T>(
	frames: readonly TimedFrame<T>[],
	share: FrameShare,
): TimedFrame<T>[] {
	const kept: TimedFrame<T>[] = [];
	for (const [i, { image, duration }] of frames.entries()) {
		const group = kept.at(-1);
		if (keepsFrame(i, share) || group === undefined) {
			kept.push({ image, duration });
		} else {
			kept[kept.length - 1] = { image: group.image, duration: group.duration + duration };
		}
	}
	return kept;
}

/** Whether {@link dropFrames} keeps frame `index`. */
export function keepsFrame(index: number, { keep, of }: FrameShare): boolean {
	return Math.floor((index * keep) / of) !== Math.floor(((index - 1) * keep) / of);
}

/** The share of `frameCount` frames to decode: all of them, or {@link MAX_FRAMES}. */
export function decodedShare(frameCount: number): FrameShare {
	return frameCount > MAX_FRAMES ? { keep: MAX_FRAMES, of: frameCount } : { keep: 1, of: 1 };
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

/** Encodes `frames` at `size` with `colors`, resolving the result only if it fits. */
type EncodeFitting<T> = (
	frames: readonly TimedFrame<T>[],
	colors: number,
	size: number,
) => Promise<FittedAnimation | undefined>;

/** Draws the frames again only when they or the size change. */
function fittingEncoder<T>({
	maxBytes,
	render,
	encode = encodeApng,
	onAttempt,
}: FitAnimationOptions<T>): EncodeFitting<T> {
	let drawn:
		| Readonly<{ frames: readonly TimedFrame<T>[]; size: number; pixels: ArrayBuffer[] }>
		| undefined;
	return async (frames, colors, size) => {
		const pixels =
			drawn?.frames === frames && drawn.size === size
				? drawn.pixels
				: await render(
						frames.map(({ image }) => image),
						size,
					);
		drawn = { frames, size, pixels };
		const durations = frames.map(({ duration }) => duration);
		const seconds = durations.reduce((sum, duration) => sum + duration, 0) / 1000;
		const encoding = { size, colors, frames: frames.length, fps: frames.length / seconds };
		onAttempt?.(encoding);
		const apng = encode(pixels, size, colors, durations);
		return apng.length <= maxBytes ? { apng, encoding } : undefined;
	};
}

/** Frames and colors to encode at the largest of `sizes` that fits. */
type Sweep<T> = Readonly<{
	frames: readonly TimedFrame<T>[];
	colors: number;
	sizes: readonly number[];
}>;

/** The sweeps {@link fitAnimation} tries, in order. */
function fittingSweeps<T>(frames: readonly TimedFrame<T>[], sizes: readonly number[]): Sweep<T>[] {
	const preferred = sizes.filter((size, i) => i === 0 || size >= PREFERRED_MIN_SIZE);
	const smaller = sizes.slice(preferred.length);
	const thinned = FRAME_SHARES.map((share) => dropFrames(frames, share)).filter(
		(kept, i, all) => kept.length >= 2 && kept.length !== all[i - 1]?.length,
	);
	const fewest = thinned.at(-1) ?? frames;
	return [
		...thinned.flatMap((kept) =>
			COLORS.map((colors) => ({ frames: kept, colors, sizes: preferred })),
		),
		...COLORS.map((colors) => ({ frames: fewest, colors, sizes: smaller })),
		...halvings(fewest).map((kept) => ({
			frames: kept,
			colors: COLORS[2],
			sizes: sizes.slice(-1),
		})),
	];
}

/** Every other frame dropped, again and again while two or more remain: the last resort. */
function halvings<T>(frames: readonly TimedFrame<T>[]): TimedFrame<T>[][] {
	const halved = dropFrames(frames, { keep: 1, of: 2 });
	return halved.length >= 2 && halved.length < frames.length ? [halved, ...halvings(halved)] : [];
}

async function encodeFirstFitting<T>(
	[sweep, ...rest]: readonly Sweep<T>[],
	encode: EncodeFitting<T>,
): Promise<FittedAnimation | undefined> {
	if (!sweep) {
		return undefined;
	}
	return (await encodeLargestFitting(sweep, encode)) ?? encodeFirstFitting(rest, encode);
}

/**
 * Encodes the largest of the sweep's sizes that fits, assuming a smaller size never encodes larger:
 * the smallest first, so a sweep where nothing fits costs one small attempt, then by bisection.
 */
async function encodeLargestFitting<T>(
	{ frames, colors, sizes }: Sweep<T>,
	encode: EncodeFitting<T>,
): Promise<FittedAnimation | undefined> {
	const smallest = sizes.at(-1);
	const fitting = smallest === undefined ? undefined : await encode(frames, colors, smallest);
	return (
		fitting &&
		encodeLargerFitting(sizes.slice(0, -1), fitting, (size) => encode(frames, colors, size))
	);
}

/** Bisects `larger`, the sizes above `fitting`'s, largest first, for the largest that fits. */
async function encodeLargerFitting(
	larger: readonly number[],
	fitting: FittedAnimation,
	encodeAt: (size: number) => Promise<FittedAnimation | undefined>,
): Promise<FittedAnimation> {
	const middle = Math.floor(larger.length / 2);
	const size = larger[middle];
	if (size === undefined) {
		return fitting;
	}
	const fits = await encodeAt(size);
	return fits
		? encodeLargerFitting(larger.slice(0, middle), fits, encodeAt)
		: encodeLargerFitting(larger.slice(middle + 1), fitting, encodeAt);
}
