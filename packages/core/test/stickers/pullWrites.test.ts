import { open, readdir } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout } from "node:timers/promises";

import { afterEach, expect, it, vi } from "vitest";

import { pullPack } from "../../src/stickers/pull.ts";
import { fakeCdn, PACK_LOCATOR, tempDir } from "../support/index.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return { ...original, open: vi.fn<typeof original.open>(original.open) };
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(open).mockReset();
});

it("removes partial files and waits for other writes before cleaning up a failed pull", async () => {
	const dir = await tempDir();
	const failure = new Error("disk full");
	await failFirstWrite(failure);
	const cdn = fakeCdn({ stickers: [{ id: 0 }, { id: 1 }] });

	await expect(pullPack({ dir, cdn, locator: PACK_LOCATOR })).rejects.toBe(failure);

	expect(await readdir(dir)).toEqual([]);
});

async function failFirstWrite(failure: Error): Promise<void> {
	const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	vi.mocked(open).mockImplementation(async (...args) => {
		const handle = await original.open(...args);
		const write = handle.writeFile.bind(handle);
		const name = basename(String(args[0]));
		vi.spyOn(handle, "writeFile").mockImplementation(async (data, options) => {
			if (name === "001.png") {
				await write("partial");
				throw failure;
			}
			await setTimeout(30);
			return write(data, options);
		});
		return handle;
	});
}
