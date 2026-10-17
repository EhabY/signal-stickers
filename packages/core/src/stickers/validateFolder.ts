import { open } from "node:fs/promises";
import { join } from "node:path";

import { ignoreNotFound } from "../util/isNotFound.ts";
import { readPack, type Pack } from "./pack.ts";
import { packImageFiles, STICKER_LIMITS, validatePack, type ValidationIssue } from "./validate.ts";

/**
 * A pack folder's `pack.json` and the bytes of each image it names that exists. Images over
 * `STICKER_LIMITS.maxBytes` are left unread, with their byte length in `oversizedImages`.
 */
export type PackFolder = Readonly<{
	pack: Pack;
	images: ReadonlyMap<string, Uint8Array>;
	oversizedImages: ReadonlyMap<string, number>;
}>;

/**
 * Reads `pack.json` and the images it names from `dir` and validates them with `validatePack`.
 * Throws `PackFormatError` when `pack.json` itself is malformed.
 */
export async function validatePackFolder(dir: string): Promise<ValidationIssue[]> {
	const { pack, images, oversizedImages } = await readPackFolder(dir);
	return validatePack(pack, images, oversizedImages);
}

/** Reads `pack.json` and the images it names from `dir`, leaving out missing images. */
export async function readPackFolder(dir: string): Promise<PackFolder> {
	const pack = await readPack(dir);
	const images = new Map<string, Uint8Array>();
	const oversizedImages = new Map<string, number>();
	await Promise.all(
		packImageFiles(pack).map(async (file) => {
			const handle = await open(join(dir, file)).catch(ignoreNotFound);
			if (!handle) {
				return;
			}
			try {
				const { size } = await handle.stat();
				if (size > STICKER_LIMITS.maxBytes) {
					oversizedImages.set(file, size);
				} else {
					images.set(file, await handle.readFile());
				}
			} finally {
				await handle.close();
			}
		}),
	);
	return { pack, images, oversizedImages };
}
