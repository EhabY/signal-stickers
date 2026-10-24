import type { Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { isAnimatedWebp, type Pack } from "@signal-stickers/shared";

import { ignoreNotFound } from "../util/isNotFound.ts";
import { mapConcurrent } from "../util/mapConcurrent.ts";
import { readPack } from "./pack.ts";
import {
	checkImage,
	checkOversizedImage,
	packImageFiles,
	STICKER_LIMITS,
	validatePack,
	type ImageCheck,
	type ValidationIssue,
} from "./validate.ts";

/**
 * A pack folder's `pack.json`, and the check of each image it names that exists. `images` holds the
 * bytes of those within `STICKER_LIMITS.maxBytes`; larger ones are checked by their headers alone.
 */
export type PackFolder = Readonly<{
	pack: Pack;
	images: ReadonlyMap<string, Uint8Array>;
	checks: ReadonlyMap<string, ImageCheck>;
}>;

const IMAGE_READ_CONCURRENCY = 8;

/**
 * Reads `pack.json` and the images it names from `dir` and validates them with `validatePack`.
 * Throws `PackFormatError` when `pack.json` itself is malformed.
 */
export function validatePackFolder(dir: string): Promise<ValidationIssue[]> {
	return createPackFolderValidator()(dir);
}

/**
 * Like {@link validatePackFolder}, for validating a folder again and again: reads an image again
 * only when its size or modification time changed since the previous call.
 */
export function createPackFolderValidator(): (dir: string) => Promise<ValidationIssue[]> {
	let previous: Readonly<{ dir: string; checks: ReadonlyMap<string, StampedCheck> }> | undefined;
	return async (dir) => {
		const pack = await readPack(dir);
		const reusable = previous?.dir === dir ? previous.checks : new Map<string, StampedCheck>();
		const checks = new Map<string, StampedCheck>();
		await forEachImage(dir, pack, async (file, handle, { size, mtimeMs }) => {
			const stamp = `${size}:${mtimeMs}`;
			const reused = reusable.get(file);
			const check = reused?.stamp === stamp ? reused : (await readImage(file, handle, size)).check;
			checks.set(file, { ...check, stamp });
		});
		previous = { dir, checks };
		return validatePack(pack, checks);
	};
}

/** Reads `pack.json` and the images it names from `dir`, leaving out missing images. */
export async function readPackFolder(dir: string): Promise<PackFolder> {
	const pack = await readPack(dir);
	const images = new Map<string, Uint8Array>();
	const checks = new Map<string, ImageCheck>();
	await forEachImage(dir, pack, async (file, handle, { size }) => {
		const { check, bytes } = await readImage(file, handle, size);
		checks.set(file, check);
		if (bytes) {
			images.set(file, bytes);
		}
	});
	return { pack, images, checks };
}

type StampedCheck = ImageCheck & Readonly<{ stamp: string }>;

/** Runs `task` on each image that `pack` names and `dir` holds, while the image is open. */
async function forEachImage(
	dir: string,
	pack: Pack,
	task: (file: string, handle: FileHandle, stats: Stats) => Promise<void>,
): Promise<void> {
	await mapConcurrent(packImageFiles(pack), IMAGE_READ_CONCURRENCY, async (file) => {
		const handle = await open(join(dir, file)).catch(ignoreNotFound);
		if (!handle) {
			return;
		}
		try {
			await task(file, handle, await handle.stat());
		} finally {
			await handle.close();
		}
	});
}

/** Checks an image, reading it whole unless it is over the byte limit. */
async function readImage(
	file: string,
	handle: FileHandle,
	size: number,
): Promise<{ check: ImageCheck; bytes?: Uint8Array }> {
	if (size > STICKER_LIMITS.maxBytes) {
		const animated = await isAnimatedWebp((offset, length) => readAt(handle, offset, length));
		return { check: checkOversizedImage(file, { length: size, animated }) };
	}
	const bytes = await handle.readFile();
	return { check: checkImage(file, bytes), bytes };
}

async function readAt(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
	const { buffer, bytesRead } = await handle.read(new Uint8Array(length), 0, length, offset);
	return buffer.subarray(0, bytesRead);
}
