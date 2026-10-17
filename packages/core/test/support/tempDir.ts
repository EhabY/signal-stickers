import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

/** A fresh directory removed when the current test finishes. */
export async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "signal-stickers-"));
	onTestFinished(() => rm(dir, { recursive: true, force: true }));
	return dir;
}
