import { describe, expect, it } from "vitest";

import { decodeStickerPack } from "../../src/protocol/protobuf.ts";
import { decryptAttachment, derivePackKeys } from "../../src/stickers/crypto.ts";
import { encryptPack, type EncryptedPack } from "../../src/stickers/encryptPack.ts";
import type { Pack } from "../../src/stickers/pack.ts";
import { stickerPng } from "../support/index.ts";

const PACK: Pack = {
	title: "Cats",
	author: "Ehab",
	cover: "001.png",
	stickers: [
		{ file: "001.png", emoji: "😀" },
		{ file: "002.png", emoji: "😾" },
	],
};
const IMAGES = { "001.png": stickerPng(1), "002.png": stickerPng(2), "cover.png": stickerPng(9) };

function encrypt(pack: Pack, images: Readonly<Record<string, Uint8Array>> = IMAGES) {
	return encryptPack(pack, new Map(Object.entries(images)));
}

function decrypt({ packKey, manifest, images }: EncryptedPack) {
	const keys = derivePackKeys(Buffer.from(packKey, "hex"));
	return {
		manifest: decodeStickerPack(decryptAttachment(manifest, keys)),
		images: images.map((image) => decryptAttachment(image, keys)),
	};
}

describe("encryptPack", () => {
	it("numbers stickers in pack order with their emoji", () => {
		const { manifest, images } = decrypt(encrypt(PACK));

		expect(manifest).toEqual({
			title: "Cats",
			author: "Ehab",
			cover: { id: 0, emoji: "😀" },
			stickers: [
				{ id: 0, emoji: "😀" },
				{ id: 1, emoji: "😾" },
			],
		});
		expect(images).toEqual(
			[IMAGES["001.png"], IMAGES["002.png"]].map((image) => Buffer.from(image)),
		);
	});

	it("reuses the first sticker whose image matches the cover", () => {
		const images = { ...IMAGES, "cover.png": IMAGES["002.png"] };

		const decrypted = decrypt(encrypt({ ...PACK, cover: "cover.png" }, images));

		expect(decrypted.manifest.cover).toEqual({ id: 1, emoji: "😾" });
		expect(decrypted.images).toHaveLength(2);
	});

	it("uploads a separate cover after the stickers with the next id", () => {
		const { manifest, images } = decrypt(encrypt({ ...PACK, cover: "cover.png" }));

		expect(manifest.cover).toEqual({ id: 2 });
		expect(images).toHaveLength(3);
		expect(images[2]).toEqual(Buffer.from(IMAGES["cover.png"]));
	});

	it("uses a fresh pack key each time", () => {
		const { packKey } = encrypt(PACK);

		expect(packKey).toMatch(/^[0-9a-f]{64}$/u);
		expect(encrypt(PACK).packKey).not.toBe(packKey);
	});
});
