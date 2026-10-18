export type ImageFormat = "png" | "webp";

export type ImageInfo = Readonly<{
	format: ImageFormat;
	width: number;
	height: number;
	/** How many times an APNG plays, 0 meaning forever; undefined for an image that does not animate. */
	plays?: number | undefined;
	/** Set for a WebP with two or more frames; Signal animates only APNG stickers. */
	animated?: true | undefined;
}>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** Detects PNG (including APNG) and WebP from their magic bytes. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | undefined {
	if (startsWith(bytes, PNG_SIGNATURE)) {
		return "png";
	}
	if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) {
		return "webp";
	}
	return undefined;
}

/** Reads the format, dimensions, and APNG play count from PNG/APNG/WebP headers. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
	const format = sniffImageFormat(bytes);
	if (format === "png") {
		return readPngInfo(bytes);
	}
	if (format === "webp") {
		return readWebpInfo(bytes);
	}
	return undefined;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[i] === byte);
}

const PNG_SIGNATURE_SIZE = 8;
const PNG_CHUNK_HEADER_SIZE = 8;
const PNG_CHUNK_CRC_SIZE = 4;

/** Reads IHDR, and the play count of an APNG. */
function readPngInfo(bytes: Uint8Array): ImageInfo | undefined {
	const view = dataView(bytes);
	const ihdr = PNG_SIGNATURE_SIZE + PNG_CHUNK_HEADER_SIZE;
	if (bytes.length < ihdr + 8 || fourCc(bytes, PNG_SIGNATURE_SIZE + 4) !== "IHDR") {
		return undefined;
	}
	const plays = readApngPlays(bytes, view);
	return { format: "png", width: view.getUint32(ihdr), height: view.getUint32(ihdr + 4), plays };
}

function dataView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourCc(bytes: Uint8Array, offset: number): string {
	return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

/**
 * Like Signal's `getAnimatedPngDataIfExists`: an `acTL` chunk before the first `IDAT` marks an APNG,
 * and its `num_plays` follows `num_frames`.
 */
function readApngPlays(bytes: Uint8Array, view: DataView): number | undefined {
	let offset = PNG_SIGNATURE_SIZE;
	while (offset + PNG_CHUNK_HEADER_SIZE <= bytes.length) {
		const type = fourCc(bytes, offset + 4);
		if (type === "acTL") {
			const plays = offset + PNG_CHUNK_HEADER_SIZE + 4;
			return plays + 4 <= bytes.length ? view.getUint32(plays) : undefined;
		}
		if (type === "IDAT") {
			return undefined;
		}
		offset += PNG_CHUNK_HEADER_SIZE + view.getUint32(offset) + PNG_CHUNK_CRC_SIZE;
	}
	return undefined;
}

const RIFF_HEADER_SIZE = 12;
const RIFF_CHUNK_HEADER_SIZE = 8;
const WEBP_CHUNK = RIFF_HEADER_SIZE + RIFF_CHUNK_HEADER_SIZE;
const VP8_START_CODE = [0x9d, 0x01, 0x2a];
const VP8L_SIGNATURE = 0x2f;
const VP8X_ANIMATION_FLAG = 0x02;

/** Reads the first chunk after the RIFF header: lossy `VP8 `, lossless `VP8L`, or extended `VP8X`. */
function readWebpInfo(bytes: Uint8Array): ImageInfo | undefined {
	const view = dataView(bytes);
	switch (fourCc(bytes, RIFF_HEADER_SIZE)) {
		case "VP8 ":
			// A 3-byte frame tag and the start code precede two 14-bit dimensions.
			if (
				bytes.length < WEBP_CHUNK + 10 ||
				!VP8_START_CODE.every((byte, i) => bytes[WEBP_CHUNK + 3 + i] === byte)
			) {
				return undefined;
			}
			return webpInfo(
				view.getUint16(WEBP_CHUNK + 6, true) & 0x3fff,
				view.getUint16(WEBP_CHUNK + 8, true) & 0x3fff,
			);
		case "VP8L": {
			// The signature precedes 14-bit width and height, each stored minus one.
			if (bytes.length < WEBP_CHUNK + 5 || bytes[WEBP_CHUNK] !== VP8L_SIGNATURE) {
				return undefined;
			}
			const bits = view.getUint32(WEBP_CHUNK + 1, true);
			return webpInfo((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
		}
		case "VP8X": {
			// Flags and 3 reserved bytes precede 24-bit canvas width and height, each minus one.
			if (bytes.length < WEBP_CHUNK + 10) {
				return undefined;
			}
			const uint24 = (offset: number) =>
				view.getUint16(offset, true) + (view.getUint8(offset + 2) << 16);
			const info = webpInfo(uint24(WEBP_CHUNK + 4) + 1, uint24(WEBP_CHUNK + 7) + 1);
			const animated = hasWebpAnimationFlag(bytes) && countWebpFrames(bytes, 2) > 1;
			return animated ? { ...info, animated: true } : info;
		}
		default:
			return undefined;
	}
}

/** Reads up to `length` bytes of an image at `offset`, fewer past its end. */
export type ReadImageBytes = (offset: number, length: number) => Promise<Uint8Array>;

/**
 * Like `readImageInfo`'s `animated`, for an image too large to read whole: reads only the `VP8X`
 * flags and the chunk headers up to the second `ANMF`.
 */
export async function isAnimatedWebp(read: ReadImageBytes): Promise<boolean> {
	const head = await read(0, WEBP_CHUNK + 1);
	if (
		sniffImageFormat(head) !== "webp" ||
		fourCc(head, RIFF_HEADER_SIZE) !== "VP8X" ||
		!hasWebpAnimationFlag(head)
	) {
		return false;
	}
	const end = RIFF_CHUNK_HEADER_SIZE + dataView(head).getUint32(4, true);
	let offset = RIFF_HEADER_SIZE;
	let frames = 0;
	while (frames < 2 && offset + RIFF_CHUNK_HEADER_SIZE <= end) {
		// oxlint-disable-next-line no-await-in-loop -- each chunk header says where the next one is.
		const header = await read(offset, RIFF_CHUNK_HEADER_SIZE);
		if (header.length < RIFF_CHUNK_HEADER_SIZE) {
			break;
		}
		if (fourCc(header, 0) === "ANMF") {
			frames += 1;
		}
		offset = nextChunkOffset(header, offset);
	}
	return frames > 1;
}

function webpInfo(width: number, height: number): ImageInfo {
	return { format: "webp", width, height };
}

function hasWebpAnimationFlag(bytes: Uint8Array): boolean {
	return ((bytes[WEBP_CHUNK] ?? 0) & VP8X_ANIMATION_FLAG) !== 0;
}

/**
 * Counts `ANMF` chunks, up to `limit`. Encoders also set the animation flag on a single frame, which
 * shows as a still image.
 */
function countWebpFrames(bytes: Uint8Array, limit: number): number {
	let offset = RIFF_HEADER_SIZE;
	let frames = 0;
	while (frames < limit && offset + RIFF_CHUNK_HEADER_SIZE <= bytes.length) {
		const header = bytes.subarray(offset, offset + RIFF_CHUNK_HEADER_SIZE);
		if (fourCc(header, 0) === "ANMF") {
			frames += 1;
		}
		offset = nextChunkOffset(header, offset);
	}
	return frames;
}

/** The offset of the chunk after the one whose header, at `offset`, is `header`. */
function nextChunkOffset(header: Uint8Array, offset: number): number {
	const size = dataView(header).getUint32(4, true);
	// RIFF pads a chunk of odd size with a byte.
	return offset + RIFF_CHUNK_HEADER_SIZE + size + (size % 2);
}
