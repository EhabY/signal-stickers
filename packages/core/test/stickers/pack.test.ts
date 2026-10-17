import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	PackFormatError,
	parsePack,
	readPack,
	writePack,
	type Pack,
} from "../../src/stickers/pack.ts";
import { tempDir } from "../support/index.ts";

const PACK: Pack = {
	title: "Cats",
	author: "Ehab",
	cover: "002.png",
	stickers: [{ file: "001.png", emoji: "😀" }, { file: "002.png" }],
};

const withSticker = (sticker: unknown) => ({ ...PACK, stickers: [sticker] });

describe("pack.json", () => {
	it("round-trips through a folder", async () => {
		const dir = await tempDir();

		await writePack(dir, PACK);

		expect(await readPack(dir)).toEqual(PACK);
	});

	it("drops unknown fields", () => {
		expect(parsePack({ ...PACK, extra: true })).toEqual(PACK);
	});

	it.each([
		["a non-object", []],
		["missing stickers", { ...PACK, stickers: undefined }],
		["a non-string title", { ...PACK, title: 1 }],
		["a non-object sticker", withSticker("001.png")],
		["a non-string emoji", withSticker({ file: "001.png", emoji: 1 })],
		["an empty file name", withSticker({ file: "" })],
		["a parent directory", withSticker({ file: ".." })],
		["a POSIX path", withSticker({ file: "a/001.png" })],
		["a Windows path", withSticker({ file: "a\\001.png" })],
		["a drive-relative path", withSticker({ file: "C:001.png" })],
		["pack.json itself", { ...PACK, cover: "pack.json" }],
		["pack.json in another case", { ...PACK, cover: "PACK.JSON" }],
	])("rejects %s", (_, value) => {
		expect(() => parsePack(value)).toThrow(PackFormatError);
	});

	it("rejects invalid JSON", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "pack.json"), "{");

		await expect(readPack(dir)).rejects.toThrow(PackFormatError);
	});
});
