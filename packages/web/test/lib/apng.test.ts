import { describe, expect, it, vi } from "vitest";

import { isReadyApng } from "../../src/lib/animatedImage.ts";
import {
	dropFrames,
	encodeApng,
	fitAnimation,
	fittingSizes,
	frameDuration,
	frameStep,
	type ApngEncoder,
	type FitAttempt,
	type TimedFrame,
} from "../../src/lib/apng.ts";
import { decodeApng, noiseFrame, solidFrame } from "../support/animation.ts";
import { LIMITS } from "../support/api.ts";

const SIZES = fittingSizes({ width: 512, height: 512 }, LIMITS);

/** Frames 0 to count - 1, each showing for 100 ms. */
function frames(count: number): TimedFrame<number>[] {
	return Array.from({ length: count }, (_, image) => ({ image, duration: 100 }));
}

/** Fits `timed` frames of {@link solidFrame}s, or of `draw`, in 300 KiB, recording each attempt. */
async function fit(
	timed: readonly TimedFrame<number>[],
	options: { encode?: ApngEncoder; sizes?: readonly number[]; draw?: typeof solidFrame } = {},
) {
	const { encode, sizes = SIZES, draw = solidFrame } = options;
	const attempts: FitAttempt[] = [];
	const apng = await fitAnimation({
		frames: timed,
		sizes,
		maxBytes: LIMITS.maxBytes,
		render: (images, size) => Promise.resolve(images.map((image) => draw(image, size))),
		...(encode && { encode }),
		onAttempt(attempt) {
			attempts.push(attempt);
		},
	});
	return { apng, attempts };
}

/** An encoder whose output fits only once `fits` says so. */
function encoderFitting(fits: (attempt: FitAttempt) => boolean) {
	return vi.fn<ApngEncoder>((pixels, size, colors) => {
		const length = fits({ size, colors, frames: pixels.length }) ? 1 : LIMITS.maxBytes + 1;
		return new Uint8Array(length);
	});
}

describe("fittingSizes", () => {
	it.each([
		["a large image", { width: 1000, height: 600 }, [512, 448, 384, 320, 256, 192, 160, 128]],
		["a small image at its own size", { width: 200, height: 150 }, [200, 192, 160, 128]],
		["a tiny image at the least size", { width: 4, height: 4 }, [10]],
	])("starts %s", (_, image, sizes) => {
		expect(fittingSizes(image, LIMITS)).toEqual(sizes);
	});
});

describe("fitAnimation", () => {
	it("tries sizes down to 256, then fewer colors, then every other frame, then smaller sizes", async () => {
		const { apng, attempts } = await fit(frames(5), { encode: encoderFitting(() => false) });

		expect(apng).toBeUndefined();
		expect(attempts).toEqual([
			...[512, 448, 384, 320].map((size) => ({ size, colors: 256, frames: 5 })),
			{ size: 256, colors: 256, frames: 5 },
			{ size: 256, colors: 128, frames: 5 },
			{ size: 256, colors: 64, frames: 5 },
			{ size: 256, colors: 64, frames: 3 },
			{ size: 256, colors: 64, frames: 2 },
			...[192, 160, 128].map((size) => ({ size, colors: 64, frames: 2 })),
		]);
	});

	it("tries fewer colors and frames at a start size below 256 before going smaller", async () => {
		const sizes = fittingSizes({ width: 200, height: 200 }, LIMITS);

		const { attempts } = await fit(frames(3), { sizes, encode: encoderFitting(() => false) });

		expect(attempts).toEqual([
			{ size: 200, colors: 256, frames: 3 },
			{ size: 200, colors: 128, frames: 3 },
			{ size: 200, colors: 64, frames: 3 },
			{ size: 200, colors: 64, frames: 2 },
			...[192, 160, 128].map((size) => ({ size, colors: 64, frames: 2 })),
		]);
	});

	it("stops at the first encoding that fits", async () => {
		const encode = encoderFitting(({ size }) => size <= 384);

		const { apng, attempts } = await fit(frames(2), { encode });

		expect(apng).toHaveLength(1);
		expect(attempts.map(({ size }) => size)).toEqual([512, 448, 384]);
	});

	it("passes the frames' pixels and durations to the encoder", async () => {
		const encode = encoderFitting(() => true);

		await fit(
			[
				{ image: 7, duration: 40 },
				{ image: 9, duration: 1500 },
			],
			{ encode },
		);

		expect(encode).toHaveBeenCalledWith(
			[solidFrame(7, 512), solidFrame(9, 512)],
			512,
			256,
			[40, 1500],
		);
	});

	it("encodes a square APNG that loops forever, with each frame's delay", async () => {
		const { apng } = await fit(
			[
				{ image: 1, duration: 40 },
				{ image: 2, duration: 1500 },
				{ image: 3, duration: 70_000 },
			],
			{ sizes: [64] },
		);

		expect(decodeApng(apng!)).toEqual({
			width: 64,
			height: 64,
			plays: 0,
			delays: [40, 1500, 65_535],
		});
		expect(isReadyApng(apng!, LIMITS)).toBe(true);
	});

	it("shrinks a busy animation until it fits in 300 KiB", async () => {
		const { apng, attempts } = await fit(frames(2), { draw: noiseFrame });

		const last = attempts.at(-1)!;
		expect(apng!.length).toBeLessThanOrEqual(LIMITS.maxBytes);
		expect(isReadyApng(apng!, LIMITS)).toBe(true);
		expect(decodeApng(apng!)).toMatchObject({ width: last.size, plays: 0 });
		expect(last).toMatchObject({ colors: 256, frames: 2 });
		expect(last.size).toBeLessThan(512);
	});
});

describe("dropFrames", () => {
	it("keeps the first of every group, showing it for the whole group", () => {
		const timed = [10, 20, 30, 40, 50].map((duration, image) => ({ image, duration }));

		expect(dropFrames(timed, 2)).toEqual([
			{ image: 0, duration: 30 },
			{ image: 2, duration: 70 },
			{ image: 4, duration: 50 },
		]);
		expect(dropFrames(timed, 4)).toEqual([
			{ image: 0, duration: 100 },
			{ image: 4, duration: 50 },
		]);
	});
});

describe("frameStep", () => {
	it.each([
		[100, 1],
		[101, 2],
		[200, 2],
		[201, 4],
		[1000, 16],
	])("keeps at most 100 of %i frames by a step of %i", (count, step) => {
		expect(frameStep(count)).toBe(step);
	});
});

describe("frameDuration", () => {
	it.each([
		[40_000, 40],
		[1_500_000, 1500],
		[10_000, 100],
		[0, 100],
		[null, 100],
	])("shows a frame of %s microseconds for %i ms", (microseconds, milliseconds) => {
		expect(frameDuration(microseconds)).toBe(milliseconds);
	});
});

describe("encodeApng", () => {
	it("writes num_plays 0, so Signal accepts the loop", () => {
		const apng = encodeApng([solidFrame(1, 32), solidFrame(2, 32)], 32, 64, [100, 100]);

		expect(decodeApng(apng).plays).toBe(0);
	});
});
