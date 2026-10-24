export type WebpAnimation = Readonly<{
	width: number;
	height: number;
	frames: readonly WebpFrame[];
}>;

/** An `ANMF` frame as a still WebP. */
export type WebpFrame = Readonly<{
	image: Uint8Array<ArrayBuffer>;
	x: number;
	y: number;
	width: number;
	height: number;
	/** In milliseconds. */
	duration: number;
	blend: boolean;
	disposal: "keep" | "clear";
}>;

export class MalformedWebpError extends Error {
	override name = "MalformedWebpError";
}

/** Splits an animated WebP into still WebPs, up to a chunk that ends early. */
export function splitWebp(bytes: Uint8Array): WebpAnimation {
	const view = dataView(bytes);
	const canvas = RIFF_HEADER_SIZE + CHUNK_HEADER_SIZE;
	if (bytes.length < canvas + 10) {
		throw new MalformedWebpError("The WebP ends early");
	}
	return {
		width: uint24(view, canvas + 4) + 1,
		height: uint24(view, canvas + 7) + 1,
		frames: riffChunks(bytes, RIFF_HEADER_SIZE)
			.filter(({ type }) => type === "ANMF")
			.map(({ data }) => webpFrame(data)),
	};
}

const RIFF_HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;
const ANMF_HEADER_SIZE = 16;
const VP8X_ALPHA_FLAG = 0x10;
const IMAGE_CHUNKS = new Set(["ALPH", "VP8 ", "VP8L"]);

type RiffChunk = Readonly<{ type: string; data: Uint8Array; chunk: Uint8Array }>;

/** Each `chunk` includes its header and pad byte. */
function riffChunks(bytes: Uint8Array, start: number): RiffChunk[] {
	const view = dataView(bytes);
	const chunks: RiffChunk[] = [];
	let offset = start;
	while (offset + CHUNK_HEADER_SIZE <= bytes.length) {
		const size = view.getUint32(offset + 4, true);
		const end = offset + CHUNK_HEADER_SIZE + size;
		if (end > bytes.length) {
			break;
		}
		const next = Math.min(end + (size % 2), bytes.length);
		chunks.push({
			type: String.fromCodePoint(...bytes.subarray(offset, offset + 4)),
			data: bytes.subarray(offset + CHUNK_HEADER_SIZE, end),
			chunk: bytes.subarray(offset, next),
		});
		offset = next;
	}
	return chunks;
}

/** A lossy frame's `ALPH` chunk needs a `VP8X` header; a lone bitstream does not. */
function webpFrame(data: Uint8Array): WebpFrame {
	if (data.length < ANMF_HEADER_SIZE) {
		throw new MalformedWebpError("A WebP frame ends early");
	}
	const view = dataView(data);
	const width = uint24(view, 6) + 1;
	const height = uint24(view, 9) + 1;
	const flags = view.getUint8(15);
	const image = riffChunks(data, ANMF_HEADER_SIZE)
		.filter(({ type }) => IMAGE_CHUNKS.has(type))
		.map(({ chunk }) => chunk);
	const header = image.length > 1 ? [vp8xChunk(width, height)] : [];
	const body = concat([ascii("WEBP"), ...header, ...image]);
	return {
		image: concat([ascii("RIFF"), uint32Le(body.length), body]),
		x: uint24(view, 0) * 2,
		y: uint24(view, 3) * 2,
		width,
		height,
		duration: uint24(view, 12),
		blend: (flags & 0x02) === 0,
		disposal: (flags & 0x01) === 0 ? "keep" : "clear",
	};
}

/** Flags, 3 reserved bytes, then the width and height minus one in 24 bits each. */
function vp8xChunk(width: number, height: number): Uint8Array<ArrayBuffer> {
	const chunk = concat([ascii("VP8X"), uint32Le(10), new Uint8Array(10)]);
	const view = dataView(chunk);
	view.setUint8(CHUNK_HEADER_SIZE, VP8X_ALPHA_FLAG);
	setUint24(view, CHUNK_HEADER_SIZE + 4, width - 1);
	setUint24(view, CHUNK_HEADER_SIZE + 7, height - 1);
	return chunk;
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function uint24(view: DataView, offset: number): number {
	return view.getUint16(offset, true) + (view.getUint8(offset + 2) << 16);
}

function setUint24(view: DataView, offset: number, value: number): void {
	view.setUint16(offset, value & 0xff_ff, true);
	view.setUint8(offset + 2, value >> 16);
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(text, (char) => char.codePointAt(0) ?? 0);
}

function uint32Le(value: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}
