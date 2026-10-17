import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "../util/isRecord.ts";

export class PackFormatError extends Error {
	override name = "PackFormatError";
}

export const PACK_FILE = "pack.json";

export type PackSticker = {
	/** Image file name inside the pack folder. */
	file: string;
	emoji?: string;
};

/** The `pack.json` describing a pack folder. */
export type Pack = {
	title: string;
	author: string;
	/** Image file name of the cover, either a sticker's or a separate one. */
	cover: string;
	stickers: PackSticker[];
};

export async function readPack(dir: string): Promise<Pack> {
	const text = await readFile(join(dir, PACK_FILE), "utf8");
	try {
		return parsePack(JSON.parse(text));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new PackFormatError(`${PACK_FILE} is not valid JSON`, { cause: error });
		}
		throw error;
	}
}

export async function writePack(dir: string, pack: Pack): Promise<void> {
	await writeFile(join(dir, PACK_FILE), formatPack(pack));
}

/** Validates `pack` and returns the text of its `pack.json`. */
export function formatPack(pack: Pack): string {
	return `${JSON.stringify(parsePack(pack), null, "\t")}\n`;
}

export function parsePack(value: unknown): Pack {
	if (!isRecord(value) || !Array.isArray(value.stickers)) {
		throw new PackFormatError(`${PACK_FILE} must be an object with stickers`);
	}
	return {
		title: stringField(value, "title"),
		author: stringField(value, "author"),
		cover: fileField(value, "cover"),
		stickers: value.stickers.map((sticker: unknown, i) => {
			if (!isRecord(sticker)) {
				throw new PackFormatError(`stickers[${i}] must be an object`);
			}
			const file = fileField(sticker, "file", `stickers[${i}].`);
			if (sticker.emoji === undefined) {
				return { file };
			}
			return { file, emoji: stringField(sticker, "emoji", `stickers[${i}].`) };
		}),
	};
}

function stringField(record: Record<string, unknown>, key: string, path = ""): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new PackFormatError(`${path}${key} must be a string`);
	}
	return value;
}

function fileField(record: Record<string, unknown>, key: string, path = ""): string {
	const value = stringField(record, key, path);
	if (!isFileName(value)) {
		throw new PackFormatError(`${path}${key} must be a file name in the pack`);
	}
	return value;
}

// Portable across Windows and POSIX, and never escapes the pack folder.
const RESERVED_CHARACTERS = /[\\/:*?"<>|\p{Cc}]/u;

function isFileName(value: string): boolean {
	return (
		value !== "" &&
		value !== "." &&
		value !== ".." &&
		value.toLowerCase() !== PACK_FILE &&
		!RESERVED_CHARACTERS.test(value)
	);
}
