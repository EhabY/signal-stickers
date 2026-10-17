import { randomBytes } from "node:crypto";

import { encodeStickerPack, type StickerProto } from "../protocol/protobuf.ts";
import { strictAssert } from "../util/assert.ts";
import { derivePackKeys, encryptAttachment, PACK_KEY_SIZE } from "./crypto.ts";
import type { Pack, PackSticker } from "./pack.ts";

export type EncryptedPack = Readonly<{
	/** The new pack's key, 64 hex chars. */
	packKey: string;
	manifest: Uint8Array;
	/** In upload order: the stickers, then the cover when it is not one of them. */
	images: Uint8Array[];
}>;

/**
 * Encrypts a validated pack under a fresh random key like Signal's sticker creator: sticker ids
 * follow the pack order, and the cover reuses the first sticker with the same image or is
 * appended with the next id.
 */
export function encryptPack(
	{ title, author, cover, stickers }: Pack,
	images: ReadonlyMap<string, Uint8Array>,
): EncryptedPack {
	const imageOf = (file: string) => {
		const image = images.get(file);
		strictAssert(image !== undefined, "validated images are present");
		return image;
	};
	const stickerImages = stickers.map(({ file }) => imageOf(file));
	const coverImage = imageOf(cover);
	const manifestStickers = stickers.map((sticker, id) => toStickerProto(sticker, id));
	const coverIndex = stickerImages.findIndex((image) => Buffer.compare(image, coverImage) === 0);
	const coverSticker = coverIndex === -1 ? undefined : manifestStickers[coverIndex];
	const manifest = encodeStickerPack({
		title,
		author,
		cover: coverSticker ?? { id: stickers.length },
		stickers: manifestStickers,
	});

	const packKey = randomBytes(PACK_KEY_SIZE);
	const keys = derivePackKeys(packKey);
	return {
		packKey: packKey.toString("hex"),
		manifest: encryptAttachment(manifest, keys),
		images: (coverSticker ? stickerImages : [...stickerImages, coverImage]).map((image) =>
			encryptAttachment(image, keys),
		),
	};
}

function toStickerProto({ emoji }: PackSticker, id: number): StickerProto {
	return emoji === undefined ? { id } : { id, emoji };
}
