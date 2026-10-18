import { describe, expect, it } from "vitest";

import { isAnimatedWebp, readImageInfo, sniffImageFormat } from "../../src/stickers/image.ts";
import { imageFixture, png, stickerWebp } from "../support/index.ts";

const WEBP_ANIMATIONS = [
	["a still WebP with alpha", stickerWebp(["ALPH", "VP8 "]), undefined],
	["an animation of one frame", stickerWebp(["ANIM", "ANMF", "EXIF"]), undefined],
	["an animation of two frames", stickerWebp(["ANIM", "ANMF", "ANMF", "EXIF"]), true],
	[
		"an animation cut off in its second frame",
		stickerWebp(["ANIM", "ANMF", "ANMF"]).subarray(0, -6),
		undefined,
	],
	[
		"an animation whose frames start by the 64th chunk",
		stickerWebp(["ANIM", ...Array.from({ length: 60 }, () => "EXIF"), "ANMF", "ANMF"]),
		true,
	],
	[
		"an animation whose frames start past the 64th chunk",
		stickerWebp(["ANIM", ...Array.from({ length: 62 }, () => "EXIF"), "ANMF", "ANMF"]),
		undefined,
	],
] as const;

describe("sniffImageFormat", () => {
	it.each([
		["png", png(0), "png"],
		["webp", Buffer.from("RIFFsizeWEBPVP8 "), "webp"],
		["other RIFF", Buffer.from("RIFFsizeWAVEfmt "), undefined],
		["gif", Buffer.from("GIF89a"), undefined],
		["empty", new Uint8Array(), undefined],
	])("detects %s", (_, bytes, format) => {
		expect(sniffImageFormat(bytes)).toBe(format);
	});
});

describe("readImageInfo", () => {
	it.each([
		["still.png", { format: "png", width: 300, height: 200 }],
		["animated.png", { format: "png", width: 301, height: 201, plays: 0 }],
		["lossy.webp", { format: "webp", width: 302, height: 202 }],
		["lossless.webp", { format: "webp", width: 303, height: 203 }],
		["animated.webp", { format: "webp", width: 304, height: 204, animated: true }],
		["alpha.webp", { format: "webp", width: 305, height: 205 }],
	])("reads %s", (name, info) => {
		expect(readImageInfo(imageFixture(name))).toEqual(info);
	});

	it.each(WEBP_ANIMATIONS)("tells whether %s animates", (_, bytes, animated) => {
		expect(readImageInfo(bytes)).toEqual({ format: "webp", width: 512, height: 512, animated });
	});

	it.each([
		["a PNG without IHDR", png(0)],
		["a WebP with an unknown chunk", Buffer.from("RIFFsizeWEBPALPH0000000000000000")],
		["a truncated WebP", imageFixture("lossy.webp").subarray(0, 24)],
		["a GIF", Buffer.from("GIF89a")],
		["nothing", new Uint8Array()],
	])("rejects %s", (_, bytes) => {
		expect(readImageInfo(bytes)).toBeUndefined();
	});
});

describe("isAnimatedWebp", () => {
	it.each([...WEBP_ANIMATIONS, ["a PNG", imageFixture("animated.png"), undefined]] as const)(
		"tells from its headers whether %s animates",
		async (_, bytes, animated) => {
			const read = (offset: number, length: number) =>
				Promise.resolve(bytes.subarray(offset, offset + length));

			expect(await isAnimatedWebp(read)).toBe(animated === true);
		},
	);
});
