import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

import type { CdnClient } from "../../src/net/cdn.ts";
import { HttpError } from "../../src/net/http.ts";
import { encodeStickerPack, type StickerPackProto } from "../../src/protocol/protobuf.ts";
import { derivePackKeys, encryptAttachment } from "../../src/stickers/crypto.ts";
import { buildPackLink, type PackLocator } from "../../src/stickers/link.ts";

export * from "./https.ts";
export type { StickerPackProto };

export const PACK_ID = "b9439fa5fdc8b9873fe64f01b88b8ccf";
export const PACK_KEY = "01".repeat(32);
export const PACK_LOCATOR: PackLocator = { packId: PACK_ID, packKey: PACK_KEY };
export const PACK_LINK = buildPackLink(PACK_LOCATOR);
export const PACK_KEYS = derivePackKeys(Buffer.from(PACK_KEY, "hex"));

/** A PNG signature followed by `byte`, enough to identify the image. */
export function png(byte: number): Uint8Array {
	return Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, byte);
}

export type FakeCdn = CdnClient & { stickerRequests: number[] };

export type FakeCdnOptions = {
	/** Sticker images by id; missing ids serve `png(id)`. */
	images?: readonly Uint8Array[] | undefined;
	/** A sticker id whose download fails. */
	failingStickerId?: number | undefined;
};

/** Serves `manifest` and its stickers for {@link PACK_ID}, encrypted with {@link PACK_KEY}. */
export function fakeCdn(
	manifest: StickerPackProto,
	{ images = [], failingStickerId }: FakeCdnOptions = {},
): FakeCdn {
	const stickerRequests: number[] = [];
	return {
		stickerRequests,
		getManifest: (packId) => encryptedFor(packId, encodeStickerPack(manifest)),
		getSticker: (packId, id) => {
			stickerRequests.push(id);
			return id === failingStickerId
				? Promise.reject(new HttpError("Sticker download failed", { status: 500 }))
				: encryptedFor(packId, images[id] ?? png(id));
		},
	};
}

/** A fresh directory removed when the current test finishes. */
export async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "signal-stickers-"));
	onTestFinished(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function encryptedFor(packId: string, data: Uint8Array): Promise<Uint8Array> {
	return packId === PACK_ID
		? Promise.resolve(encryptAttachment(data, PACK_KEYS))
		: Promise.reject(new HttpError("Not found", { status: 404 }));
}
