import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	ignoreNotFound,
	isNotFound,
	packImageFiles,
	PACK_FILE,
	parsePack,
	readPack,
	removeStickerAt,
	renameWithRetries,
	replaceStickerImage,
	sniffImageFormat,
	writePack,
	type ImageFormat,
	type Pack,
} from "@signal-stickers/core";

import { ApiError } from "./errors.ts";

/** The one pack folder the editor works on. Changes run one at a time so none is lost. */
export type WorkingCopy = Readonly<{
	dir: string;
	/** Throws a 404 {@link ApiError} when there is no pack yet. */
	read(): Promise<Pack>;
	/** Replaces `pack.json` with `value`; every file it names must already exist. */
	update(value: unknown): Promise<Pack>;
	/** Reads an image that `pack.json` names. */
	readImage(file: string): Promise<Uint8Array>;
	/** Saves a PNG or WebP image as a new sticker without an emoji. */
	addSticker(image: Uint8Array): Promise<{ pack: Pack; file: string }>;
	/**
	 * Removes the sticker at `index` when its image is `file`, and the image unless the pack still
	 * uses it.
	 */
	removeSticker(index: number, file: string): Promise<Pack>;
	/**
	 * Saves a PNG or WebP image under a new name as the image of the sticker at `index`, when its image
	 * is `file`, and as the cover if that was `file`. Removes `file` unless the pack still uses it.
	 */
	replaceSticker(index: number, file: string, image: Uint8Array): Promise<Pack>;
	/** Saves a PNG or WebP image as the separate cover, removing the previous separate cover. */
	setCover(image: Uint8Array): Promise<Pack>;
	/** Lets `fill` write a fresh sibling folder and swaps it in only when `fill` succeeds. */
	replace<T>(fill: (dir: string) => Promise<T>): Promise<T>;
	/** Runs `task` while nothing else changes the folder, e.g. to upload it. */
	whileLocked<T>(task: () => Promise<T>): Promise<T>;
}>;

export function createWorkingCopy(dir: string): WorkingCopy {
	const serialize = createQueue();
	return {
		dir,
		read: () => readWorkingPack(dir),
		update: (value) => serialize(() => updatePack(dir, value)),
		readImage: (file) => readImage(dir, file),
		addSticker: (image) => serialize(() => addSticker(dir, image)),
		removeSticker: (index, file) => serialize(() => removeSticker(dir, index, file)),
		replaceSticker: (index, file, image) =>
			serialize(() => replaceSticker(dir, index, file, image)),
		setCover: (image) => serialize(() => setCover(dir, image)),
		replace: (fill) => serialize(() => replaceFolder(dir, fill)),
		whileLocked: serialize,
	};
}

/** Runs tasks one after another, whether or not earlier ones failed. */
function createQueue() {
	let last: Promise<unknown> = Promise.resolve();
	return <T>(task: () => Promise<T>): Promise<T> => {
		const result = last.then(task);
		last = result.catch(() => {});
		return result;
	};
}

async function readWorkingPack(dir: string): Promise<Pack> {
	try {
		return await readPack(dir);
	} catch (error) {
		if (isNotFound(error)) {
			throw new ApiError(404, "There is no pack yet: pull one first", { cause: error });
		}
		throw error;
	}
}

async function updatePack(dir: string, value: unknown): Promise<Pack> {
	await readWorkingPack(dir);
	const pack = parsePack(value);
	await Promise.all(
		packImageFiles(pack).map(async (file) => {
			const isFile = await stat(join(dir, file)).then(
				(stats) => stats.isFile(),
				() => false,
			);
			if (!isFile) {
				throw new ApiError(400, `${file} is not in the working copy`);
			}
		}),
	);
	await writePack(dir, pack);
	return pack;
}

async function readImage(dir: string, file: string): Promise<Uint8Array> {
	if (!packImageFiles(await readWorkingPack(dir)).includes(file)) {
		throw new ApiError(404, `${file} is not in the pack`);
	}
	return readFile(join(dir, file));
}

async function addSticker(dir: string, image: Uint8Array): Promise<{ pack: Pack; file: string }> {
	const format = imageFormat(image);
	const pack = await readWorkingPack(dir);
	const file = `${await nextImageNumber(dir)}.${format}`;
	await writeFile(join(dir, file), image, { flag: "wx" });
	const updated = { ...pack, stickers: [...pack.stickers, { file }] };
	await writePack(dir, updated);
	return { pack: updated, file };
}

function imageFormat(image: Uint8Array): ImageFormat {
	const format = sniffImageFormat(image);
	if (!format) {
		throw new ApiError(415, "Images must be PNG or WebP");
	}
	return format;
}

/**
 * One past the highest numbered file left, so a new image never overwrites another. Removing the
 * highest numbered image frees its number for the next one.
 */
async function nextImageNumber(dir: string): Promise<string> {
	const numbers = (await readdir(dir)).map((name) => Number(/^\d+/u.exec(name)?.[0] ?? 0));
	return String(Math.max(0, ...numbers) + 1).padStart(3, "0");
}

async function removeSticker(dir: string, index: number, file: string): Promise<Pack> {
	const pack = await readWorkingPack(dir);
	assertStickerImage(pack, index, file);
	return writePackWithout(dir, removeStickerAt(pack, index), file);
}

/** A 404 unless the sticker at `index` has the image `file`, since the position may be stale. */
function assertStickerImage(pack: Pack, index: number, file: string): void {
	if (pack.stickers[index]?.file !== file) {
		throw new ApiError(404, `${file} is not sticker ${index + 1} in the pack`);
	}
}

/** Writes `pack`, then removes the image `file` unless `pack` still uses it. */
async function writePackWithout(dir: string, pack: Pack, file: string): Promise<Pack> {
	await writePack(dir, pack);
	if (!packImageFiles(pack).includes(file)) {
		await rm(join(dir, file), { force: true });
	}
	return pack;
}

async function replaceSticker(
	dir: string,
	index: number,
	file: string,
	image: Uint8Array,
): Promise<Pack> {
	const format = imageFormat(image);
	const pack = await readWorkingPack(dir);
	assertStickerImage(pack, index, file);
	const replacement = `${await nextImageNumber(dir)}.${format}`;
	await writeFile(join(dir, replacement), image, { flag: "wx" });
	return writePackWithout(dir, replaceStickerImage(pack, index, replacement), file);
}

async function setCover(dir: string, image: Uint8Array): Promise<Pack> {
	const format = imageFormat(image);
	const pack = await readWorkingPack(dir);
	const file = `cover.${format}`;
	if (pack.stickers.some((sticker) => sticker.file === file)) {
		throw new ApiError(409, `A sticker uses ${file}, so the cover cannot replace it`);
	}
	await writeFile(join(dir, file), image);
	return writePackWithout(dir, { ...pack, cover: file }, pack.cover);
}

async function replaceFolder<T>(dir: string, fill: (staging: string) => Promise<T>): Promise<T> {
	await assertReplaceable(dir);
	// Owner-only like the credentials, since by default this creates the tool's config directory.
	await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(`${dir}.pull-`);
	try {
		const result = await fill(staging);
		await moveOnto(staging, dir);
		return result;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/** Only replaces a pack, so a `--dir` pointing at other files never deletes them. */
async function assertReplaceable(dir: string): Promise<void> {
	const entries = await readdir(dir).catch(ignoreNotFound);
	if (entries && entries.length > 0 && !entries.includes(PACK_FILE)) {
		throw new ApiError(
			409,
			`${dir} holds files but no ${PACK_FILE}, so importing would delete them. Restart the server with an empty --dir.`,
		);
	}
}

/** Replaces `target` with `source`, restoring the old `target` if the swap fails. */
async function moveOnto(source: string, target: string): Promise<void> {
	const backup = `${source}.old`;
	const hadTarget = await renameIfExists(target, backup);
	try {
		await renameWithRetries(source, target);
	} catch (error) {
		if (hadTarget) {
			await renameWithRetries(backup, target);
		}
		throw error;
	}
	await rm(backup, { recursive: true, force: true, maxRetries: 3 });
}

async function renameIfExists(from: string, to: string): Promise<boolean> {
	try {
		await renameWithRetries(from, to);
		return true;
	} catch (error) {
		if (isNotFound(error)) {
			return false;
		}
		throw error;
	}
}
