import { describe, expect, it } from "vitest";

import type { Pack } from "../../src/stickers/pack.ts";
import {
	readImageInfo,
	STICKER_LIMITS,
	validateImage,
	validatePack,
} from "../../src/stickers/validate.ts";
import { imageFixture, png, stickerPng, validPack } from "../support/index.ts";

function validate(pack: Pack, images: Readonly<Record<string, Uint8Array>>) {
	return validatePack(pack, new Map(Object.entries(images)));
}

function pngOfLength(length: number) {
	const image = stickerPng(0);
	return Buffer.concat([image, new Uint8Array(length - image.length)]);
}

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

describe("validateImage", () => {
	it("accepts a 512x512 PNG within the byte limit", () => {
		expect(validateImage("001.png", pngOfLength(STICKER_LIMITS.maxBytes))).toEqual([]);
	});

	it("rejects an image that is not 512x512", () => {
		expect(validateImage("001.webp", imageFixture("lossy.webp"))).toEqual([
			{
				code: "wrongSize",
				file: "001.webp",
				message: "001.webp is 302x202 pixels; stickers must be 512x512",
			},
		]);
	});

	it.each([10, 320, 512])("accepts a square APNG %i pixels wide", (size) => {
		const apng = stickerPng(0, { width: size, height: size, plays: 0 });

		expect(validateImage("001.png", apng)).toEqual([]);
	});

	it.each([
		[9, 9],
		[513, 513],
		[320, 300],
	])("rejects a %ix%i APNG", (width, height) => {
		expect(validateImage("001.png", stickerPng(0, { width, height, plays: 0 }))).toEqual([
			{
				code: "wrongSize",
				file: "001.png",
				message: `001.png is ${width}x${height} pixels; animated stickers must be square, from 10x10 to 512x512`,
			},
		]);
	});

	it("rejects an APNG that stops playing", () => {
		expect(validateImage("001.png", stickerPng(0, { plays: 1 }))).toEqual([
			{ code: "mustLoopForever", file: "001.png", message: "001.png must loop forever" },
		]);
	});

	it("rejects an image in another format", () => {
		expect(validateImage("001.gif", Buffer.from("GIF89a"))).toEqual([
			{ code: "unsupportedFormat", file: "001.gif", message: "001.gif is not a PNG or WebP image" },
		]);
	});

	it("rejects an image over 300 KiB", () => {
		expect(validateImage("001.png", pngOfLength(STICKER_LIMITS.maxBytes + 1))).toEqual([
			{
				code: "tooLarge",
				file: "001.png",
				message: "001.png is 301 KiB; stickers must be at most 300 KiB",
			},
		]);
	});
});

describe("validatePack", () => {
	it("accepts a valid pack", () => {
		const { pack, images } = validPack();

		expect(validate(pack, images)).toEqual([]);
	});

	it("accepts an animated sticker and a separate cover", () => {
		const { pack, images } = validPack();

		const issues = validate(
			{ ...pack, cover: "cover.png" },
			{ ...images, "002.png": stickerPng(2, { plays: 0 }), "cover.png": stickerPng(9) },
		);

		expect(issues).toEqual([]);
	});

	it("requires a title and an author", () => {
		const { pack, images } = validPack();

		const issues = validate({ ...pack, title: " ", author: "" }, images);

		expect(issues.map(({ code }) => code)).toEqual(["missingTitle", "missingAuthor"]);
	});

	it("requires a sticker", () => {
		const { pack, images } = validPack(1);

		expect(validate({ ...pack, stickers: [] }, images)).toEqual([
			{ code: "tooFewStickers", message: "The pack needs at least 1 sticker" },
		]);
	});

	it("allows up to 200 stickers", () => {
		const atLimit = validPack(200);
		const overLimit = validPack(201);

		expect(validate(atLimit.pack, atLimit.images)).toEqual([]);
		expect(validate(overLimit.pack, overLimit.images)).toEqual([
			{ code: "tooManyStickers", message: "The pack has 201 stickers; the limit is 200" },
		]);
	});

	it("requires an emoji for each sticker", () => {
		const { pack, images } = validPack();

		const issues = validate(
			{ ...pack, stickers: [{ file: "001.png" }, { file: "002.png", emoji: "" }] },
			images,
		);

		expect(issues).toEqual([
			{ code: "missingEmoji", file: "001.png", message: "001.png needs an emoji" },
			{ code: "missingEmoji", file: "002.png", message: "002.png needs an emoji" },
		]);
	});

	it("reports missing images, the cover included", () => {
		const { pack } = validPack();

		const issues = validate({ ...pack, cover: "cover.png" }, { "001.png": stickerPng(0) });

		expect(issues).toEqual([
			{ code: "missingImage", file: "002.png", message: "002.png is missing" },
			{ code: "missingImage", file: "cover.png", message: "cover.png is missing" },
		]);
	});

	it("checks an image used twice once", () => {
		const { pack } = validPack(1);

		const issues = validate(pack, { "001.png": Buffer.from("GIF89a") });

		expect(issues.map(({ code, file }) => [code, file])).toEqual([
			["unsupportedFormat", "001.png"],
		]);
	});
});
