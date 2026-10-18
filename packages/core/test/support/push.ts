import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import type { CdnClient, UploadForm } from "../../src/net/cdn.ts";
import { HttpError } from "../../src/net/http.ts";
import { writePack, type Pack } from "../../src/stickers/pack.ts";
import { STICKER_LIMITS } from "../../src/stickers/validate.ts";
import { fakeChat, type FakeChat } from "./chat.ts";
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

export type PackFixture = { pack: Pack; images: Record<string, Uint8Array> };

/** A pack that passes validation: `count` stickers `001.png`, … with emoji, the first as cover. */
export function validPack(count = 2): PackFixture {
	const stickers = Array.from({ length: count }, (_, i) => ({
		file: `${String(i + 1).padStart(3, "0")}.png`,
		emoji: "😀",
	}));
	return {
		pack: { title: "Cats", author: "Ehab", cover: "001.png", stickers },
		images: Object.fromEntries(stickers.map(({ file }, i) => [file, stickerPng(i)])),
	};
}

export type StickerPngOptions = {
	width?: number;
	height?: number;
	/** Makes an APNG that plays this many times, 0 meaning forever. */
	plays?: number;
};

/** A minimal PNG, 512x512 unless overridden, made distinct by `byte`. */
export function stickerPng(
	byte: number,
	{ width = STICKER_LIMITS.size, height = STICKER_LIMITS.size, plays }: StickerPngOptions = {},
): Uint8Array {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	// 8-bit RGBA
	header.set([8, 6], 8);
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", header),
		...(plays === undefined ? [] : [pngChunk("acTL", animationControl(plays))]),
		pngChunk("IDAT", Uint8Array.of(byte)),
		pngChunk("IEND", new Uint8Array()),
	]);
}

/**
 * An extended WebP, 512x512 unless overridden, whose `VP8X` header precedes a chunk of each type in
 * `chunks`, each with 3 bytes of data and a pad byte. An `ANIM` chunk sets the animation flag.
 */
export function stickerWebp(
	chunks: readonly string[],
	{
		width = STICKER_LIMITS.size,
		height = STICKER_LIMITS.size,
	}: Pick<StickerPngOptions, "width" | "height"> = {},
): Uint8Array {
	const header = Buffer.alloc(10);
	header.writeUInt8(chunks.includes("ANIM") ? VP8X_ANIMATION_FLAG : 0, 0);
	header.writeUIntLE(width - 1, 4, 3);
	header.writeUIntLE(height - 1, 7, 3);
	const body = Buffer.concat([
		Buffer.from("WEBP"),
		riffChunk("VP8X", header),
		...chunks.map((type) => riffChunk(type, Uint8Array.of(1, 2, 3))),
	]);
	return Buffer.concat([Buffer.from("RIFF"), uint32Le(body.length), body]);
}

/** Reads an image from `test/fixtures/images`. */
export function imageFixture(name: string): Uint8Array {
	return readFileSync(join(import.meta.dirname, "../fixtures/images", name));
}

/** The pack id {@link fakeUploadChat} hands out. */
export const NEW_PACK_ID = "0123456789abcdef0123456789abcdef";

/** An S3 upload slot for `key` as the chat service hands it out. */
export function uploadForm(key: string): UploadForm {
	return {
		key,
		credential: "AKIA/20261017/us-east-1/s3/aws4_request",
		acl: "private",
		algorithm: "AWS4-HMAC-SHA256",
		date: "20261017T000000Z",
		policy: "cG9saWN5",
		signature: "c2lnbmF0dXJl",
	};
}

/** A chat service that answers `GET /v1/sticker/pack/form/{count}` with {@link stickerUploadForms}. */
export function fakeUploadChat(): FakeChat {
	return fakeChat(({ method, path }) => {
		const count = /^\/v1\/sticker\/pack\/form\/(?<count>\d+)$/u.exec(path)?.groups?.count;
		if (method !== "GET" || count === undefined) {
			throw new HttpError(`${method} ${path} failed with status 404`, { status: 404 });
		}
		return stickerUploadForms(Number(count));
	});
}

/** The chat service's answer to `GET /v1/sticker/pack/form/{count}`, for {@link NEW_PACK_ID}. */
export function stickerUploadForms(count: number) {
	return {
		packId: NEW_PACK_ID,
		manifest: uploadForm(`stickers/${NEW_PACK_ID}/manifest.proto`),
		stickers: Array.from({ length: count }, (_, id) => ({
			id,
			...uploadForm(`stickers/${NEW_PACK_ID}/full/${id}`),
		})),
	};
}

export type CdnUpload = { form: UploadForm; data: Uint8Array };
export type MemoryCdn = CdnClient & { uploads: CdnUpload[] };

/** A CDN that serves each upload at its form's key, so `pullPack` reads back a pushed pack. */
export function memoryCdn(): MemoryCdn {
	const uploads: CdnUpload[] = [];
	const serve = (key: string) => {
		const upload = uploads.findLast(({ form }) => form.key === key);
		return upload
			? Promise.resolve(upload.data)
			: Promise.reject(new HttpError("Not found", { status: 404 }));
	};
	return {
		uploads,
		getManifest: (packId) => serve(`stickers/${packId}/manifest.proto`),
		getSticker: (packId, id) => serve(`stickers/${packId}/full/${id}`),
		upload: (form, data) => {
			uploads.push({ form, data });
			return Promise.resolve();
		},
	};
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pngChunk(type: string, data: Uint8Array): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** An `acTL` chunk's data: one frame, played `plays` times. */
function animationControl(plays: number): Buffer {
	const data = Buffer.alloc(8);
	data.writeUInt32BE(1, 0);
	data.writeUInt32BE(plays, 4);
	return data;
}

const VP8X_ANIMATION_FLAG = 0x02;

/** A RIFF chunk, padded to an even length. */
function riffChunk(type: string, data: Uint8Array): Buffer {
	const padding = new Uint8Array(data.length % 2);
	return Buffer.concat([Buffer.from(type, "latin1"), uint32Le(data.length), data, padding]);
}

function uint32Le(value: number): Buffer {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32LE(value);
	return bytes;
}
