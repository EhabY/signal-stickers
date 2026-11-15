import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { ignoreNotFound } from "./isNotFound.ts";
import { mapConcurrent } from "./mapConcurrent.ts";

export class DirectoryNotEmptyError extends Error {
	override name = "DirectoryNotEmptyError";
}

export type FolderFile = Readonly<{ name: string; data: Uint8Array | string }>;

const WRITE_CONCURRENCY = 8;

/** Throws {@link DirectoryNotEmptyError} unless `dir` is missing or empty. */
export async function assertEmptyDirectory(dir: string): Promise<void> {
	const entries = await readdir(dir).catch(ignoreNotFound);
	if (entries && entries.length > 0) {
		throw new DirectoryNotEmptyError(`${dir} is not empty`);
	}
}

/**
 * Writes `files` into `dir`, which must be missing or empty. Creates every file exclusively, and
 * removes the ones it wrote if any write fails.
 */
export async function writeFolder(dir: string, files: readonly FolderFile[]): Promise<void> {
	await mkdir(dir, { recursive: true });
	await assertEmptyDirectory(dir);
	const written: string[] = [];
	try {
		await mapConcurrent(files, WRITE_CONCURRENCY, async ({ name, data }) => {
			const handle = await open(join(dir, name), "wx");
			written.push(name);
			try {
				await handle.writeFile(data);
			} finally {
				await handle.close();
			}
		});
	} catch (error) {
		await Promise.all(written.map((name) => rm(join(dir, name), { force: true })));
		throw error;
	}
}
