import { readImageInfo } from "@signal-stickers/shared";
import { describe, expect, it } from "vitest";

import { MalformedWebpError, splitWebp } from "../../src/lib/webpFrames.ts";
import { anmfChunk, extendedWebp } from "../support/animation.ts";

/** A WebP's RIFF size and the types of its chunks. */
function riffLayout(webp: Uint8Array): { size: number; chunks: string[] } {
	const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
	const chunks: string[] = [];
	for (let offset = 12; offset < webp.length;) {
		const size = view.getUint32(offset + 4, true);
		chunks.push(new TextDecoder().decode(webp.subarray(offset, offset + 4)));
		offset += 8 + size + (size % 2);
	}
	return { size: view.getUint32(4, true), chunks };
}

describe("splitWebp", () => {
	it("reads each frame's area, duration, and compositing", () => {
		const webp = extendedWebp([
			"ANIM",
			anmfChunk({ width: 512, height: 512, duration: 40 }, ["VP8L"]),
			anmfChunk({ x: 10, y: 20, width: 30, height: 40, duration: 70, flags: 0b11 }, ["VP8L"]),
		]);

		const { width, height, frames } = splitWebp(webp);

		expect({ width, height }).toEqual({ width: 512, height: 512 });
		expect(frames).toMatchObject([
			{ x: 0, y: 0, width: 512, height: 512, duration: 40, blend: true, disposal: "keep" },
			{ x: 10, y: 20, width: 30, height: 40, duration: 70, blend: false, disposal: "clear" },
		]);
	});

	it("makes a lossless frame a simple WebP of its bitstream", () => {
		const webp = extendedWebp(["ANIM", anmfChunk({ width: 8, height: 8 }, ["VP8L"])]);

		const { image } = splitWebp(webp).frames[0]!;

		expect(riffLayout(image)).toEqual({ size: image.length - 8, chunks: ["VP8L"] });
	});

	it("declares a lossy frame's alpha in a VP8X header at the frame's size", () => {
		const webp = extendedWebp([
			"ANIM",
			anmfChunk({ width: 30, height: 40 }, ["ALPH", "VP8 ", "EXIF"]),
		]);

		const { image } = splitWebp(webp).frames[0]!;

		expect(riffLayout(image)).toEqual({ size: image.length - 8, chunks: ["VP8X", "ALPH", "VP8 "] });
		expect(readImageInfo(image)).toEqual({ format: "webp", width: 30, height: 40 });
		expect(image[20]).toBe(0x10);
	});

	it("stops at a frame that ends early", () => {
		const webp = extendedWebp([
			"ANIM",
			anmfChunk({ width: 8, height: 8 }, ["VP8L"]),
			anmfChunk({ width: 8, height: 8 }, ["VP8L"]),
		]);

		expect(splitWebp(webp.subarray(0, -4)).frames).toHaveLength(1);
	});

	it("rejects a WebP that ends in its header", () => {
		expect(() => splitWebp(extendedWebp([]).subarray(0, 24))).toThrow(MalformedWebpError);
	});
});
