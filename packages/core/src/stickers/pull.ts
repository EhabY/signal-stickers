import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CdnClient } from "../net/cdn.ts";
import { decodeStickerPack, type StickerProto } from "../protocol/protobuf.ts";
import { strictAssert } from "../util/assert.ts";
import { mapConcurrent } from "../util/mapConcurrent.ts";
import { decryptAttachment, derivePackKeys, type PackKeys } from "./crypto.ts";
import { sniffImageFormat } from "./image.ts";
import type { PackLocator } from "./link.ts";
import { formatPack, PACK_FILE, PackFormatError, type Pack } from "./pack.ts";

export class DirectoryNotEmptyError extends Error {
	override name = "DirectoryNotEmptyError";
}

export type PullProgress = Readonly<{ done: number; total: number }>;

export type PullOptions = Readonly<{
	locator: PackLocator;
	/** Destination folder; created if missing and must otherwise be empty. */
	dir: string;
	cdn: CdnClient;
	signal?: AbortSignal | undefined;
	onProgress?: ((progress: PullProgress) => void) | undefined;
}>;

// Signal's reader limit; uploads are capped lower.
export const MAX_STICKERS_PER_PACK = 1024;
const DOWNLOAD_CONCURRENCY = 3;

type Sticker = StickerProto & { id: number };
type Image = Readonly<{ sticker: Sticker; data: Uint8Array }>;
type OutputFile = Readonly<{ name: string; data: Uint8Array | string }>;

/**
 * Downloads and decrypts a pack into `dir` as `001.png`, `002.webp`, …, an optional `cover.*`, and
 * `pack.json`. Nothing is written until every image has downloaded, and no existing file is ever
 * overwritten.
 */
export async function pullPack(options: PullOptions): Promise<Pack> {
	const { locator, dir, cdn, signal } = options;
	await assertEmptyDirectory(dir);
	const keys = derivePackKeys(Buffer.from(locator.packKey, "hex"));
	const manifest = decodeStickerPack(
		decryptAttachment(await cdn.getManifest(locator.packId, signal), keys),
	);

	const stickers = manifest.stickers.filter(
		(sticker): sticker is Sticker => sticker.id !== undefined,
	);
	const [first] = stickers;
	if (!first) {
		throw new PackFormatError("Sticker pack has no stickers");
	}
	if (stickers.length > MAX_STICKERS_PER_PACK) {
		throw new PackFormatError(`Sticker pack has more than ${MAX_STICKERS_PER_PACK} stickers`);
	}
	const coverId = manifest.cover?.id ?? first.id;
	const coverInList = stickers.some(({ id }) => id === coverId);
	const images = await download(coverInList ? stickers : [...stickers, { id: coverId }], {
		...options,
		keys,
	});

	const files = images.map(({ sticker, data }, index) => {
		const name = index < stickers.length ? String(index + 1).padStart(3, "0") : "cover";
		return { sticker, data, name: `${name}.${sniffImageFormat(data) ?? "bin"}` };
	});
	const cover = coverInList ? files.find(({ sticker }) => sticker.id === coverId) : files.at(-1);
	strictAssert(cover !== undefined, "the cover was downloaded");
	const pack: Pack = {
		title: manifest.title ?? "",
		author: manifest.author ?? "",
		cover: cover.name,
		stickers: files
			.slice(0, stickers.length)
			.map(({ name, sticker: { emoji } }) =>
				emoji === undefined ? { file: name } : { file: name, emoji },
			),
	};

	signal?.throwIfAborted();
	await writeFolder(dir, [...files, { name: PACK_FILE, data: formatPack(pack) }]);
	return pack;
}

async function assertEmptyDirectory(dir: string): Promise<void> {
	const entries = await readdir(dir).catch(ignoreNotFound);
	if (entries && entries.length > 0) {
		throw new DirectoryNotEmptyError(`${dir} is not empty`);
	}
}

/** Downloads every image, cancelling the rest when one fails. */
function download(
	stickers: readonly Sticker[],
	{ cdn, locator, keys, signal, onProgress }: PullOptions & { keys: PackKeys },
): Promise<Image[]> {
	let done = 0;
	return mapConcurrent(
		stickers,
		DOWNLOAD_CONCURRENCY,
		async (sticker, _index, stop) => {
			const data = decryptAttachment(await cdn.getSticker(locator.packId, sticker.id, stop), keys);
			stop.throwIfAborted();
			done += 1;
			onProgress?.({ done, total: stickers.length });
			return { sticker, data };
		},
		signal,
	);
}

/** Creates every file exclusively, and removes the ones it wrote if any write fails. */
async function writeFolder(dir: string, files: readonly OutputFile[]): Promise<void> {
	await mkdir(dir, { recursive: true });
	await assertEmptyDirectory(dir);
	const written: string[] = [];
	try {
		await Promise.all(
			files.map(async ({ name, data }) => {
				await writeFile(join(dir, name), data, { flag: "wx" });
				written.push(name);
			}),
		);
	} catch (error) {
		await Promise.all(written.map((name) => rm(join(dir, name), { force: true })));
		throw error;
	}
}

function ignoreNotFound(error: unknown): undefined {
	if (error instanceof Error && "code" in error && error.code === "ENOENT") {
		return undefined;
	}
	throw error;
}
