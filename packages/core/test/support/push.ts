import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import { writePack, type Pack } from "../../src/stickers/pack.ts";
import { STICKER_LIMITS } from "../../src/stickers/validate.ts";
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

/** Reads an image from `test/fixtures/images`. */
export function imageFixture(name: string): Uint8Array {
	return readFileSync(join(import.meta.dirname, "../fixtures/images", name));
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
