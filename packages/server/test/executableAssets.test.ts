import { readdir, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import { tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { copyAddon } from "../src/executableAssets.ts";

const encoder = new TextEncoder();

describe("copyAddon", () => {
	it("copies the addon into the cache under its hash", async () => {
		const cache = await tempDir();

		const copy = copyAddon(encoder.encode("version 1"), cache);

		expect(copy).toMatch(/libsignal-[\da-f]{16}\.node$/u);
		expect(await readFile(copy, "utf8")).toBe("version 1");
	});

	it("reuses the copy of the same addon", async () => {
		const cache = await tempDir();
		const copy = copyAddon(encoder.encode("version 1"), cache);
		const copied = await stat(copy);

		const again = copyAddon(encoder.encode("version 1"), cache);

		expect(again).toBe(copy);
		expect((await stat(again)).mtimeMs).toBe(copied.mtimeMs);
	});

	it("replaces the copy of an older addon", async () => {
		const cache = await tempDir();
		copyAddon(encoder.encode("version 1"), cache);

		const copy = copyAddon(encoder.encode("version 2"), cache);

		expect(await readdir(cache)).toEqual([basename(copy)]);
	});
});
