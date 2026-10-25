import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { copyToCache } from "../src/executableAssets.ts";

const encoder = new TextEncoder();

describe("copyToCache", () => {
	it("copies into a folder named by the hash", async () => {
		const cache = await tempDir();

		const copy = await copyToCache(encoder.encode("version 1"), cache, "libsignal.node");

		expect(basename(copy)).toBe("libsignal.node");
		expect(basename(dirname(copy))).toMatch(/^[\da-f]{16}$/u);
		expect(await readFile(copy, "utf8")).toBe("version 1");
	});

	it("reuses the copy of the same version", async () => {
		const cache = await tempDir();
		const copy = await copyToCache(encoder.encode("version 1"), cache, "libsignal.node");
		const copied = await stat(copy);

		const again = await copyToCache(encoder.encode("version 1"), cache, "libsignal.node");

		expect(again).toBe(copy);
		expect((await stat(again)).mtimeMs).toBe(copied.mtimeMs);
	});

	it("replaces the copy of an older version", async () => {
		const cache = await tempDir();
		await copyToCache(encoder.encode("version 1"), cache, "libsignal.node");

		const copy = await copyToCache(encoder.encode("version 2"), cache, "libsignal.node");

		expect(await readdir(cache)).toEqual([basename(dirname(copy))]);
		expect(await readdir(join(cache, basename(dirname(copy))))).toEqual(["libsignal.node"]);
	});
});
