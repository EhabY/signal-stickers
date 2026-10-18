import UPNG from "upng-js";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { isReadyApng } from "../../src/lib/animatedImage.ts";
import {
	decodedShare,
	dropFrames,
	encodeApng,
	fitAnimation,
	fittingSizes,
	frameDuration,
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

/** An attempt at `count` frames that last `seconds` in all. */
function attempt(size: number, colors: number, count: number, seconds: number): FitAttempt {
	return { size, colors, frames: count, fps: count / seconds };
}

/** Fits `timed` frames of {@link solidFrame}s, or of `draw`, in 300 KiB, recording each attempt. */
async function fit(
	timed: readonly TimedFrame<number>[],
	options: { encode?: ApngEncoder; sizes?: readonly number[]; draw?: typeof solidFrame } = {},
) {
	const { encode, sizes = SIZES, draw = solidFrame } = options;
	const attempts: FitAttempt[] = [];
	const fitted = await fitAnimation({
		frames: timed,
		sizes,
		maxBytes: LIMITS.maxBytes,
		render: (images, size) => Promise.resolve(images.map((image) => draw(image, size))),
		...(encode && { encode }),
		onAttempt(tried) {
			attempts.push(tried);
		},
	});
	return { fitted, attempts };
}

/** An encoder whose output fits only at `size` pixels or fewer, with `colors` colors or fewer. */
function encoderFitting(size: number, colors = 256) {
	return vi.fn<ApngEncoder>((_, tried, triedColors) => {
		const fits = tried <= size && triedColors <= colors;
		return new Uint8Array(fits ? 1 : LIMITS.maxBytes + 1);
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
	it("keeps every frame at the largest size down to 160 with 256, then 128, then 64 colors", async () => {
		const encode = encoderFitting(320, 64);

		const { fitted, attempts } = await fit(frames(5), { encode });

		expect(fitted?.encoding).toEqual(attempt(320, 64, 5, 0.5));
		expect(attempts).toEqual([
			attempt(512, 256, 5, 0.5),
			attempt(160, 256, 5, 0.5),
			attempt(160, 128, 5, 0.5),
			attempt(160, 64, 5, 0.5),
			attempt(320, 64, 5, 0.5),
			attempt(448, 64, 5, 0.5),
			attempt(384, 64, 5, 0.5),
		]);
	});

	it("then keeps 2 of every 3 frames, 1 of 2, and 1 of 3, before sizes below 160", async () => {
		const { fitted, attempts } = await fit(frames(6), { encode: encoderFitting(0) });

		expect(fitted).toBeUndefined();
		expect(attempts).toEqual([
			attempt(512, 256, 6, 0.6),
			...[6, 4, 3, 2].flatMap((count) =>
				[256, 128, 64].map((colors) => attempt(160, colors, count, 0.6)),
			),
			...[256, 128, 64].map((colors) => attempt(128, colors, 2, 0.6)),
		]);
	});

	it("drops every other frame at the smallest size as a last resort, keeping two", async () => {
		const { attempts } = await fit(frames(12), { encode: encoderFitting(0) });

		expect(attempts.slice(-4)).toEqual([
			...[256, 128, 64].map((colors) => attempt(128, colors, 4, 1.2)),
			attempt(128, 64, 2, 1.2),
		]);
	});

	it("tries fewer colors and frames at a start size below 160 before going smaller", async () => {
		const sizes = fittingSizes({ width: 150, height: 150 }, LIMITS);

		const { attempts } = await fit(frames(3), { sizes, encode: encoderFitting(0) });

		expect(attempts).toEqual([
			...[256, 128, 64].map((colors) => attempt(150, colors, 3, 0.3)),
			...[256, 128, 64].map((colors) => attempt(150, colors, 2, 0.3)),
			...[256, 128, 64].map((colors) => attempt(128, colors, 2, 0.3)),
		]);
	});

	it("bisects the sizes above the smallest that fits for the largest that fits", async () => {
		const encode = encoderFitting(384);

		const { fitted, attempts } = await fit(frames(2), { encode });

		expect(fitted?.apng).toHaveLength(1);
		expect(attempts.map(({ size }) => size)).toEqual([512, 160, 320, 384, 448]);
		expect(fitted?.encoding.size).toBe(384);
	});

	it("passes the frames' pixels and durations to the encoder", async () => {
		const encode = encoderFitting(512);

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
		const { fitted } = await fit(
			[
				{ image: 1, duration: 40 },
				{ image: 2, duration: 1500 },
				{ image: 3, duration: 70_000 },
			],
			{ sizes: [64] },
		);

		expect(decodeApng(fitted!.apng)).toEqual({
			width: 64,
			height: 64,
			plays: 0,
			delays: [40, 1500, 65_535],
		});
		expect(isReadyApng(fitted!.apng, LIMITS)).toBe(true);
	});

	it("shrinks a busy animation until it fits in 300 KiB", async () => {
		const { fitted } = await fit(frames(2), { draw: noiseFrame });

		const { apng, encoding } = fitted!;
		expect(apng.length).toBeLessThanOrEqual(LIMITS.maxBytes);
		expect(isReadyApng(apng, LIMITS)).toBe(true);
		expect(decodeApng(apng)).toMatchObject({ width: encoding.size, plays: 0 });
		expect(encoding).toMatchObject({ colors: 256, frames: 2 });
		expect(encoding.size).toBeLessThan(512);
	});
});

describe("dropFrames", () => {
	const timed = [10, 20, 30, 40, 50, 60].map((duration, image) => ({ image, duration }));

	it.each([
		[
			2,
			3,
			[
				[0, 30],
				[2, 30],
				[3, 90],
				[5, 60],
			],
		],
		[
			1,
			2,
			[
				[0, 30],
				[2, 70],
				[4, 110],
			],
		],
		[
			1,
			3,
			[
				[0, 60],
				[3, 150],
			],
		],
	])(
		"keeps %i of every %i frames, each showing for the frames dropped after it",
		(keep, of, kept) => {
			expect(dropFrames(timed, { keep, of })).toEqual(
				kept.map(([image, duration]) => ({ image, duration })),
			);
		},
	);
});

describe("decodedShare", () => {
	it.each([
		[2, 2],
		[150, 150],
		[151, 150],
		[1000, 150],
	])("keeps at most 150 of %i frames, lasting as long", (count, kept) => {
		const decoded = dropFrames(frames(count), decodedShare(count));

		expect(decoded).toHaveLength(kept);
		expect(decoded.reduce((total, { duration }) => total + duration, 0)).toBe(count * 100);
	});

	it("spreads the frames kept evenly", () => {
		const decoded = dropFrames(frames(300), decodedShare(300));

		expect(decoded.map(({ image }) => image)).toEqual(Array.from({ length: 150 }, (_, i) => i * 2));
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

	it.each([
		["keeps every color of frames with fewer than allowed", solidFrame, 0],
		["quantizes frames with more colors than allowed", noiseFrame, 64],
	])("%s", (_, draw, quantized) => {
		const encode = vi.spyOn(UPNG, "encode");
		onTestFinished(() => {
			encode.mockRestore();
		});
		const pixels = [draw(1, 32), draw(2, 32)];

		encodeApng(pixels, 32, 64, [100, 100]);

		expect(encode).toHaveBeenCalledWith(pixels, 32, 32, quantized, [100, 100]);
	});
});
