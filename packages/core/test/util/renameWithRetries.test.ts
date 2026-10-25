import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { renameWithRetries } from "../../src/util/renameWithRetries.ts";
import { tempDir } from "../support/index.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return { ...original, rename: vi.fn<typeof original.rename>(original.rename) };
});

afterEach(() => {
	vi.mocked(rename).mockClear();
});

/** A file to move, and where to, after the first `failures` renames fail with `code`. */
async function blockedMove(code: string, failures: number) {
	const dir = await tempDir();
	const from = join(dir, "from.txt");
	await writeFile(from, "moved");
	for (let i = 0; i < failures; i += 1) {
		vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error(code), { code }));
	}
	return { from, to: join(dir, "to.txt") };
}

describe("renameWithRetries", () => {
	it("retries while Windows reports a file in use", async () => {
		const { from, to } = await blockedMove("EPERM", 2);

		await renameWithRetries(from, to, { platform: "win32" });

		expect(await readFile(to, "utf8")).toBe("moved");
		expect(rename).toHaveBeenCalledTimes(3);
	});

	it("fails at once elsewhere, where the same error means no permission", async () => {
		const { from, to } = await blockedMove("EPERM", 1);

		await expect(renameWithRetries(from, to, { platform: "linux" })).rejects.toThrow("EPERM");
		expect(rename).toHaveBeenCalledOnce();
	});

	it("fails at once when the source is missing", async () => {
		const { from, to } = await blockedMove("ENOENT", 1);

		await expect(renameWithRetries(from, to, { platform: "win32" })).rejects.toThrow("ENOENT");
		expect(rename).toHaveBeenCalledOnce();
	});
});
