import UPNG from "upng-js";
import { vi } from "vitest";

import type {
	AnimationDecoder,
	ConversionMessage,
	ConversionRequest,
} from "../../src/lib/animationConversion.ts";
import type { ConversionWorker, StickerEncoder } from "../../src/lib/stickerImage.ts";

const encoder = new TextEncoder();
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A GIF header, a NETSCAPE looping extension, and `frames` one-pixel images, each with a delay. */
export function gif(frames: number): Uint8Array<ArrayBuffer> {
	// One by one pixel with a two-color table: black and white.
	const screen = [1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
	const loop = [0x21, 0xff, 11, ...encoder.encode("NETSCAPE2.0"), 3, 1, 0, 0, 0];
	// A graphic control extension with a 100 ms delay, an image descriptor, and LZW data.
	const frame = [
		0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0,
	];
	return Uint8Array.from([
		...encoder.encode("GIF89a"),
		...screen,
		...loop,
		...Array.from({ length: frames }, () => frame).flat(),
		0x3b,
	]);
}

/**
 * A 512x512 extended WebP whose `VP8X` header precedes a chunk of each type in `chunks`, each with 3
 * bytes of data and a pad byte. `ANIM` sets the animation flag, and `ALPH` the alpha flag.
 */
export function extendedWebp(chunks: readonly string[]): Uint8Array<ArrayBuffer> {
	const flags = (chunks.includes("ANIM") ? 0x02 : 0) | (chunks.includes("ALPH") ? 0x10 : 0);
	// The flags, reserved bytes, and a 512x512 canvas.
	const vp8x = [flags, 0, 0, 0, 255, 1, 0, 255, 1, 0];
	const body = [
		...encoder.encode("WEBP"),
		...riffChunk("VP8X", vp8x),
		...chunks.flatMap((type) => riffChunk(type, [1, 2, 3])),
	];
	return Uint8Array.from([...encoder.encode("RIFF"), ...uint32Le(body.length), ...body]);
}

export type PngOptions = { width: number; height: number; plays?: number; padding?: number };

/** A PNG's chunks, with an `acTL` when `plays` is set; CRCs are zero, which readers here skip. */
export function pngChunks({
	width,
	height,
	plays,
	padding = 0,
}: PngOptions): Uint8Array<ArrayBuffer> {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6], 8);
	return Uint8Array.from([
		...PNG_SIGNATURE,
		...chunk("IHDR", header),
		...(plays === undefined ? [] : chunk("acTL", uint32s(2, plays))),
		...chunk("IDAT", new Uint8Array(padding)),
		...chunk("IEND", new Uint8Array()),
	]);
}

/** A `size` square of RGBA pixels in one color, distinct for each `seed`. */
export function solidFrame(seed: number, size: number): ArrayBuffer {
	const pixels = new Uint8Array(size * size * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels.set([(seed * 47) % 256, (seed * 89) % 256, (seed * 151) % 256, 255], i);
	}
	return pixels.buffer;
}

/** A `size` square of 256-color noise, which barely compresses, different for each `seed`. */
export function noiseFrame(seed: number, size: number): ArrayBuffer {
	const pixels = new Uint8Array(size * size * 4);
	let state = seed + 1;
	for (let i = 0; i < pixels.length; i += 4) {
		// A linear congruential generator, so the frames are the same on every run.
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		const color = state >>> 24;
		pixels.set([color, 255 - color, (color * 7) & 0xff, 255], i);
	}
	return pixels.buffer;
}

export type DecodedApng = Readonly<{
	width: number;
	height: number;
	plays: number | undefined;
	delays: number[];
}>;

/** Decodes an APNG with UPNG, independently of the code that wrote it. */
export function decodeApng(bytes: Uint8Array | ArrayBuffer): DecodedApng {
	const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.slice().buffer;
	const { width, height, tabs, frames } = UPNG.decode(buffer);
	return { width, height, plays: tabs.acTL?.num_plays, delays: frames.map(({ delay }) => delay) };
}

/** A frame the fake decoder drew: which one and at what size. */
export type FakeImage = Readonly<{ index: number; size: number }>;

export type FakeDecoderOptions = {
	width?: number;
	height?: number;
	frameCount?: number;
	/** Each frame's duration in microseconds, as WebCodecs reports it. */
	duration?: number | null;
	failAt?: number;
	/** Draws a frame's pixels; solid colors by default. */
	draw?: (index: number, size: number) => ArrayBuffer;
};

/** An {@link AnimationDecoder} that records which frames it decodes and draws. */
export function fakeDecoder({
	width = 200,
	height = 100,
	frameCount = 3,
	duration = 50_000,
	failAt,
	draw = solidFrame,
}: FakeDecoderOptions = {}) {
	const decoded: { index: number; size: number | undefined }[] = [];
	const decoder = {
		width,
		height,
		frameCount,
		decode: (index: number, size?: number) => {
			decoded.push({ index, size });
			if (index === failAt) {
				return Promise.reject(new Error("Corrupt frame"));
			}
			const image = size === undefined ? undefined : { index, size };
			return Promise.resolve(image ? { duration, image } : { duration });
		},
		render: (images: readonly FakeImage[], size: number) =>
			Promise.resolve(images.map(({ index }) => draw(index, size))),
		close: vi.fn<() => void>(),
	} satisfies AnimationDecoder<FakeImage>;
	return { decoder, decoded };
}

/**
 * A {@link ConversionWorker} that answers each request with `answer`'s messages, in order, and
 * reports a failure to start through `fail`.
 */
export function fakeWorker(answer: (request: ConversionRequest) => ConversionMessage[]) {
	const listeners = new Map<string, ((event: MessageEvent<ConversionMessage>) => void)[]>();
	const dispatch = (event: MessageEvent<ConversionMessage>) => {
		for (const listener of listeners.get(event.type) ?? []) {
			listener(event);
		}
	};
	const requests: { request: ConversionRequest; transfer: Transferable[] }[] = [];
	const worker = {
		addEventListener(type: string, listener: (event: MessageEvent<ConversionMessage>) => void) {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		postMessage(request: ConversionRequest, transfer: Transferable[]) {
			requests.push({ request, transfer });
			queueMicrotask(() => {
				for (const data of answer(request)) {
					dispatch(new MessageEvent("message", { data }));
				}
			});
		},
		terminate: vi.fn<() => void>(),
	} satisfies ConversionWorker;
	const fail = () => {
		dispatch(new MessageEvent("error"));
	};
	return { worker, requests, fail };
}

/** A {@link StickerEncoder} that never finishes, rejecting once its signal aborts. */
export const encodeUntilAborted: StickerEncoder = (_image, _limits, { signal } = {}) =>
	new Promise((_, reject) => {
		signal?.addEventListener("abort", () => {
			reject(new Error("Converting was canceled"));
		});
	});

/** A RIFF chunk, padded to an even length. */
function riffChunk(type: string, data: readonly number[]): number[] {
	const padding = data.length % 2 === 0 ? [] : [0];
	return [...encoder.encode(type), ...uint32Le(data.length), ...data, ...padding];
}

function uint32Le(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function chunk(type: string, data: Uint8Array): number[] {
	return [...uint32s(data.length), ...encoder.encode(type), ...data, 0, 0, 0, 0];
}

function uint32s(...values: number[]): Uint8Array {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (const [i, value] of values.entries()) {
		view.setUint32(i * 4, value);
	}
	return bytes;
}
