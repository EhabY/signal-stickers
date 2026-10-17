import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writePack, type Pack } from "../../src/stickers/pack.ts";
import { tempDir } from "./tempDir.ts";

/** Writes `pack.json` and `images` (by file name) into a fresh temporary pack folder. */
export async function writePackFolder(
	pack: Pack,
	images: Readonly<Record<string, Uint8Array>>,
): Promise<string> {
	const dir = await tempDir();
	await writePack(dir, pack);
	await Promise.all(Object.entries(images).map(([file, data]) => writeFile(join(dir, file), data)));
	return dir;
}
