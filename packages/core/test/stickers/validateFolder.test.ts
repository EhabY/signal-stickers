import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PackFormatError } from "../../src/stickers/pack.ts";
import { readPackFolder, validatePackFolder } from "../../src/stickers/validateFolder.ts";
import { stickerPng, stickerWebp, validPack, writePackFolder } from "../support/index.ts";

const MIB = 1024 * 1024;

describe("validatePackFolder", () => {
	it("accepts a valid pack folder", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);

		expect(await validatePackFolder(dir)).toEqual([]);
	});

	it("reports images that are missing from the folder", async () => {
		const { pack } = validPack();
		const dir = await writePackFolder(pack, { "001.png": stickerPng(0) });

		expect(await validatePackFolder(dir)).toEqual([
			{ code: "missingImage", severity: "error", file: "002.png", message: "002.png is missing" },
		]);
	});

	it("reports an image over the byte limit by its size without reading it", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		await truncate(join(dir, "002.png"), MIB);

		const folder = await readPackFolder(dir);
		const issues = await validatePackFolder(dir);

		expect(folder.images.has("002.png")).toBe(false);
		expect(folder.oversizedImages).toEqual(
			new Map([["002.png", { length: MIB, animated: false }]]),
		);
		expect(issues).toEqual([
			{
				code: "tooLarge",
				severity: "error",
				file: "002.png",
				message: "002.png is 1024 KiB; stickers must be at most 300 KiB",
			},
		]);
	});

	it("reports an oversized WebP of two frames, not one, as an animation to convert", async () => {
		const { pack } = validPack();
		const images = {
			"001.webp": stickerWebp(["ANIM", "ANMF", "EXIF"]),
			"002.webp": stickerWebp(["ANIM", "ANMF", "ANMF"]),
		};
		const stickers = Object.keys(images).map((file) => ({ file, emoji: "😀" }));
		const dir = await writePackFolder({ ...pack, cover: "001.webp", stickers }, images);
		await Promise.all(Object.keys(images).map((file) => truncate(join(dir, file), MIB)));

		const issues = await validatePackFolder(dir);

		expect(issues.map(({ code, file }) => [code, file])).toEqual([
			["tooLarge", "001.webp"],
			["unsupportedAnimation", "002.webp"],
			["tooLarge", "002.webp"],
		]);
	});

	it("rejects a malformed pack.json", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		await writeFile(join(dir, "pack.json"), "{");

		await expect(validatePackFolder(dir)).rejects.toThrow(PackFormatError);
	});
});
