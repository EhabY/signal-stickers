import { describe, expect, it } from "vitest";

import { isReadyApng, sniffAnimation } from "../../src/lib/animatedImage.ts";
import { encodeApng } from "../../src/lib/apng.ts";
import { gif, pngChunks, solidFrame, webpVp8x } from "../support/animation.ts";
import { LIMITS } from "../support/api.ts";

describe("sniffAnimation", () => {
	it.each([
		["a GIF with two frames", gif(2), "image/gif"],
		["a WebP with the animation flag", webpVp8x(0x02), "image/webp"],
		["an APNG", pngChunks({ width: 600, height: 400, plays: 0 }), "image/png"],
		["a GIF with one frame", gif(1), undefined],
		["a WebP with only the alpha flag", webpVp8x(0x10), undefined],
		["a still PNG", pngChunks({ width: 512, height: 512 }), undefined],
		["a JPEG", Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), undefined],
		["nothing", new Uint8Array(), undefined],
	])("detects %s", (_, bytes, type) => {
		expect(sniffAnimation(bytes)).toBe(type);
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
