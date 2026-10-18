import { describe, expect, it } from "vitest";

import { readImageInfo, sniffImageFormat } from "../../src/stickers/image.ts";
import { imageFixture, png } from "../support/index.ts";

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
		["animated.webp", { format: "webp", width: 304, height: 204 }],
		["alpha.webp", { format: "webp", width: 305, height: 205 }],
	])("reads %s", (name, info) => {
		expect(readImageInfo(imageFixture(name))).toEqual(info);
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
