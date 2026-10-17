import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PackFormatError } from "../../src/stickers/pack.ts";
import { validatePackFolder } from "../../src/stickers/validateFolder.ts";
import { stickerPng, validPack, writePackFolder } from "../support/index.ts";

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

	it("rejects a malformed pack.json", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		await writeFile(join(dir, "pack.json"), "{");

		await expect(validatePackFolder(dir)).rejects.toThrow(PackFormatError);
	});
});
