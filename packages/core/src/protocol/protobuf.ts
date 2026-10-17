export class ProtobufError extends Error {
	override name = "ProtobufError";
}

export type StickerProto = { id?: number; emoji?: string };

export type StickerPackProto = {
	title?: string;
	author?: string;
	cover?: StickerProto;
	stickers: StickerProto[];
};

export type Field = { number: number } & (
	| { type: "varint"; value: bigint }
	| { type: "bytes"; value: Uint8Array }
);

const MAX_VARINT_BYTES = 10;
// Keeps a leading U+FEFF like Signal's decoder, so text survives a round trip.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const encoder = new TextEncoder();

/** Decodes like Signal: unknown fields are skipped and a repeated `cover` replaces the last. */
export function decodeStickerPack(bytes: Uint8Array): StickerPackProto {
	const pack: StickerPackProto = { stickers: [] };
	for (const field of readFields(bytes)) {
		switch (field.number) {
			case 1:
				pack.title = asString(field);
				break;
			case 2:
				pack.author = asString(field);
				break;
			case 3:
				pack.cover = decodeSticker(asBytes(field));
				break;
			case 4:
				pack.stickers.push(decodeSticker(asBytes(field)));
				break;
		}
	}
	return pack;
}

export function encodeStickerPack(pack: StickerPackProto): Uint8Array {
	const writer = new ProtobufWriter()
		.string(1, pack.title)
		.string(2, pack.author)
		.bytes(3, pack.cover && encodeSticker(pack.cover));
	for (const sticker of pack.stickers) {
		writer.bytes(4, encodeSticker(sticker));
	}
	return writer.finish();
}

export class ProtobufWriter {
	readonly #chunks: Uint8Array[] = [];

	uint32(number: number, value: number | undefined): this {
		if (value !== undefined) {
			if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
				throw new ProtobufError(`Field ${number} is not a uint32: ${value}`);
			}
			this.#varint(number * 8);
			this.#varint(value);
		}
		return this;
	}

	bytes(number: number, value: Uint8Array | undefined): this {
		if (value !== undefined) {
			this.#varint(number * 8 + 2);
			this.#varint(value.length);
			this.#chunks.push(value);
		}
		return this;
	}

	string(number: number, value: string | undefined): this {
		return this.bytes(number, value === undefined ? undefined : encoder.encode(value));
	}

	finish(): Uint8Array {
		return Buffer.concat(this.#chunks);
	}

	#varint(value: number): void {
		const bytes: number[] = [];
		let rest = value;
		while (rest >= 0x80) {
			bytes.push((rest % 0x80) | 0x80);
			rest = Math.floor(rest / 0x80);
		}
		bytes.push(rest);
		this.#chunks.push(Uint8Array.from(bytes));
	}
}

function decodeSticker(bytes: Uint8Array): StickerProto {
	const sticker: StickerProto = {};
	for (const field of readFields(bytes)) {
		if (field.number === 1) {
			sticker.id = asUint32(field);
		} else if (field.number === 2) {
			sticker.emoji = asString(field);
		}
	}
	return sticker;
}

function encodeSticker({ id, emoji }: StickerProto): Uint8Array {
	return new ProtobufWriter().uint32(1, id).string(2, emoji).finish();
}

/** Yields varint and length-delimited fields, skipping fixed32/fixed64. */
export function* readFields(bytes: Uint8Array): Generator<Field> {
	let pos = 0;

	const take = (length: number): Uint8Array => {
		if (pos + length > bytes.length) {
			throw new ProtobufError("Truncated message");
		}
		pos += length;
		return bytes.subarray(pos - length, pos);
	};
	const varint = (): bigint => {
		let result = 0n;
		for (let i = 0; i < MAX_VARINT_BYTES; i++) {
			const byte = bytes[pos++];
			if (byte === undefined) {
				throw new ProtobufError("Truncated varint");
			}
			result |= BigInt(byte & 0x7f) << BigInt(7 * i);
			if (byte < 0x80) {
				return result;
			}
		}
		throw new ProtobufError("Varint is too long");
	};

	while (pos < bytes.length) {
		const key = varint();
		const number = Number(key >> 3n);
		if (number === 0) {
			throw new ProtobufError("Invalid field number 0");
		}
		const wireType = Number(key & 7n);
		switch (wireType) {
			case 0:
				yield { number, type: "varint", value: varint() };
				break;
			case 1:
				take(8);
				break;
			case 2:
				yield { number, type: "bytes", value: take(Number(varint())) };
				break;
			case 5:
				take(4);
				break;
			default:
				throw new ProtobufError(`Unsupported wire type ${wireType}`);
		}
	}
}

export function asString(field: Field): string {
	return decoder.decode(asBytes(field));
}

export function asBytes(field: Field): Uint8Array {
	if (field.type !== "bytes") {
		throw new ProtobufError(`Field ${field.number} is not length-delimited`);
	}
	return field.value;
}

function asUint32(field: Field): number {
	if (field.type !== "varint") {
		throw new ProtobufError(`Field ${field.number} is not a varint`);
	}
	return Number(BigInt.asUintN(32, field.value));
}
