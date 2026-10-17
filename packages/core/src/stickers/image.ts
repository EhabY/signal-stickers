export type ImageFormat = "png" | "webp";

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

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[i] === byte);
}
