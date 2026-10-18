import { describe, expect, it } from "vitest";

import { hasWebpAnimationFlag, isReadyApng, sniffAnimation } from "../../src/lib/animatedImage.ts";
import { encodeApng } from "../../src/lib/apng.ts";
import { extendedWebp, gif, pngChunks, solidFrame } from "../support/animation.ts";
import { LIMITS } from "../support/api.ts";

describe("sniffAnimation", () => {
	it.each([
		["a GIF with two frames", gif(2), "image/gif"],
		["a WebP with two frames", extendedWebp(["ANIM", "ANMF", "ANMF", "EXIF"]), "image/webp"],
		["an APNG", pngChunks({ width: 600, height: 400, plays: 0 }), "image/png"],
		["a GIF with one frame", gif(1), undefined],
		["a WebP animation of one frame", extendedWebp(["ANIM", "ANMF", "EXIF"]), undefined],
		[
			"a WebP cut off in its second frame",
			extendedWebp(["ANIM", "ANMF", "ANMF"]).subarray(0, -6),
			undefined,
		],
		["a still WebP with alpha", extendedWebp(["ALPH", "VP8 "]), undefined],
		["a still PNG", pngChunks({ width: 512, height: 512 }), undefined],
		["a JPEG", Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), undefined],
		["nothing", new Uint8Array(), undefined],
	])("detects %s", (_, bytes, type) => {
		expect(sniffAnimation(bytes)).toBe(type);
	});
});

describe("hasWebpAnimationFlag", () => {
	it.each([
		["an animation of one frame", extendedWebp(["ANIM", "ANMF"]), true],
		["a still WebP with alpha", extendedWebp(["ALPH", "VP8 "]), false],
		["a GIF", gif(2), false],
	])("tells whether %s has the flag", (_, bytes, flagged) => {
		expect(hasWebpAnimationFlag(bytes)).toBe(flagged);
	});
});

describe("isReadyApng", () => {
	it("accepts an APNG from the encoder", () => {
		const apng = encodeApng([solidFrame(1, 64), solidFrame(2, 64)], 64, 256, [100, 100]);

		expect(isReadyApng(apng, LIMITS)).toBe(true);
	});

	it.each([
		["10 pixels wide", { width: 10, height: 10, plays: 0 }, true],
		["512 pixels wide", { width: 512, height: 512, plays: 0 }, true],
		["not square", { width: 320, height: 300, plays: 0 }, false],
		["too small", { width: 9, height: 9, plays: 0 }, false],
		["too large", { width: 513, height: 513, plays: 0 }, false],
		["playing once", { width: 512, height: 512, plays: 1 }, false],
		["over 300 KiB", { width: 512, height: 512, plays: 0, padding: LIMITS.maxBytes }, false],
		["a still PNG", { width: 512, height: 512 }, false],
	])("checks an APNG %s", (_, options, ready) => {
		expect(isReadyApng(pngChunks(options), LIMITS)).toBe(ready);
	});
});
