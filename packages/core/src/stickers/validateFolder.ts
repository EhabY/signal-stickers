import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ignoreNotFound } from "../util/isNotFound.ts";
import { readPack, type Pack } from "./pack.ts";
import { packImageFiles, validatePack, type ValidationIssue } from "./validate.ts";

/** A pack folder's `pack.json` and the bytes of each image it names that exists. */
export type PackFolder = Readonly<{ pack: Pack; images: ReadonlyMap<string, Uint8Array> }>;

/**
 * Reads `pack.json` and the images it names from `dir` and validates them with `validatePack`.
 * Throws `PackFormatError` when `pack.json` itself is malformed.
 */
export async function validatePackFolder(dir: string): Promise<ValidationIssue[]> {
	const { pack, images } = await readPackFolder(dir);
	return validatePack(pack, images);
}

/** Reads `pack.json` and the images it names from `dir`, leaving out missing images. */
export async function readPackFolder(dir: string): Promise<PackFolder> {
	const pack = await readPack(dir);
	const images = new Map<string, Uint8Array>();
	await Promise.all(
		packImageFiles(pack).map(async (file) => {
			const bytes = await readFile(join(dir, file)).catch(ignoreNotFound);
			if (bytes) {
				images.set(file, bytes);
			}
		}),
	);
	return { pack, images };
}
