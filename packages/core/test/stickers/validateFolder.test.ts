import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PackFormatError } from "../../src/stickers/pack.ts";
import { readPackFolder, validatePackFolder } from "../../src/stickers/validateFolder.ts";
import { stickerPng, validPack, writePackFolder } from "../support/index.ts";

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
			{ code: "missingImage", file: "002.png", message: "002.png is missing" },
		]);
	});

	it("reports an image over the byte limit by its size without reading it", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		await truncate(join(dir, "002.png"), MIB);

		const folder = await readPackFolder(dir);
		const issues = await validatePackFolder(dir);

		expect(folder.images.has("002.png")).toBe(false);
		expect(folder.oversizedImages).toEqual(new Map([["002.png", MIB]]));
		expect(issues).toEqual([
			{
				code: "tooLarge",
				file: "002.png",
				message: "002.png is 1024 KiB; stickers must be at most 300 KiB",
			},
		]);
	});

	it("rejects a malformed pack.json", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		await writeFile(join(dir, "pack.json"), "{");

		await expect(validatePackFolder(dir)).rejects.toThrow(PackFormatError);
	});
});
