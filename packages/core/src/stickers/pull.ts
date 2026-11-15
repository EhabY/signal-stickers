import { sniffImageFormat, type Pack } from "@signal-stickers/shared";

import type { CdnClient } from "../net/cdn.ts";
import { decodeStickerPack, type StickerProto } from "../protocol/protobuf.ts";
import { strictAssert } from "../util/assert.ts";
import { mapConcurrent } from "../util/mapConcurrent.ts";
import { assertEmptyDirectory, writeFolder } from "../util/writeFolder.ts";
import { decryptAttachment, derivePackKeys, type PackKeys } from "./crypto.ts";
import type { PackLocator } from "./link.ts";
import { formatPack, PACK_FILE, PackFormatError } from "./pack.ts";

export { DirectoryNotEmptyError } from "../util/writeFolder.ts";

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
