import { describe, expect, it, vi } from "vitest";

import {
	serveConversions,
	type AnimationDecoder,
	type ConversionMessage,
	type ConversionRequest,
	type ConversionScope,
	type OpenDecoder,
} from "../../src/lib/animationConversion.ts";
import {
	decodeApng,
	fakeDecoder,
	gif,
	noiseFrame,
	type FakeDecoderOptions,
	type FakeImage,
} from "../support/animation.ts";
import { LIMITS } from "../support/api.ts";

const REQUEST: ConversionRequest = { bytes: gif(2).buffer, type: "image/gif", limits: LIMITS };

const NO_DECODER: AnimationDecoder<FakeImage> | undefined = undefined;

/** Two frames of 50 ms at the image's longer side. */
const ENCODING = { size: 200, colors: 256, frames: 2, fps: 20 };

/** Serves one request like the worker does: the progress it posts, then its answer. */
async function convert(open: OpenDecoder<FakeImage>, request = REQUEST) {
	const progress: ConversionMessage[] = [];
	const answered = Promise.withResolvers<{ answer: ConversionMessage; transfer: Transferable[] }>();
	const listeners: ((event: MessageEvent<ConversionRequest>) => void)[] = [];
	const scope: ConversionScope = {
		addEventListener(_, listener) {
			listeners.push(listener);
		},
		postMessage(message, { transfer }) {
			if (message.type === "progress") {
				progress.push(message);
			} else {
				answered.resolve({ answer: message, transfer });
			}
		},
	};
	serveConversions(scope, open);
	for (const listener of listeners) {
		listener(new MessageEvent("message", { data: request }));
	}
	return { progress, ...(await answered.promise) };
}

function openFake(options: FakeDecoderOptions = {}) {
	const { decoder, decoded } = fakeDecoder(options);
	const open = vi.fn<OpenDecoder<FakeImage>>(() => Promise.resolve(decoder));
	return { open, decoder, decoded };
}

function apngOf(answer: ConversionMessage): ArrayBuffer {
	if (answer.type !== "done") {
		throw new Error(`Expected an APNG, not ${JSON.stringify(answer)}`);
	}
	return answer.apng;
}

describe("serveConversions", () => {
	it("reports progress, then transfers a looping APNG at the image's longer side", async () => {
		const { open, decoder } = openFake({ width: 200, height: 100, frameCount: 2 });

		const { progress, answer, transfer } = await convert(open);

		expect(progress).toEqual([
			{ type: "progress", progress: { step: "decode", done: 1, total: 2 } },
			{ type: "progress", progress: { step: "decode", done: 2, total: 2 } },
			{ type: "progress", progress: { step: "encode", ...ENCODING } },
		]);
		expect(decodeApng(apngOf(answer))).toEqual({
			width: 200,
			height: 200,
			plays: 0,
			delays: [50, 50],
		});
		expect(transfer).toEqual([apngOf(answer)]);
		expect(open).toHaveBeenCalledWith(REQUEST.bytes, "image/gif");
		expect(decoder.close).toHaveBeenCalledOnce();
	});

	it("draws 150 frames of a longer animation, each showing for those dropped after it", async () => {
		const { open, decoded } = openFake({
			width: 16,
			height: 16,
			frameCount: 300,
			duration: 30_000,
		});

		const { answer } = await convert(open);

		const drawn = decoded.filter(({ size }) => size !== undefined).map(({ index }) => index);
		expect(drawn).toEqual(Array.from({ length: 150 }, (_, i) => i * 2));
		expect(decodeApng(apngOf(answer)).delays).toEqual(Array.from({ length: 150 }, () => 60));
	});

	it("answers still for a single frame, so the page draws it as a still image", async () => {
		const { open, decoder } = openFake({ frameCount: 1 });

		expect((await convert(open)).answer).toEqual({ type: "still" });
		expect(decoder.close).toHaveBeenCalledOnce();
	});

	it("answers unsupported when the browser cannot decode the animation", async () => {
		const open = vi.fn<OpenDecoder<FakeImage>>(() => Promise.resolve(NO_DECODER));

		expect((await convert(open)).answer).toEqual({ type: "unsupported" });
	});

	it("reports a frame that fails to decode and closes the decoder", async () => {
		const { open, decoder } = openFake({ failAt: 1 });

		expect((await convert(open)).answer).toEqual({
			type: "error",
			message: "Could not convert the animation: Corrupt frame",
		});
		expect(decoder.close).toHaveBeenCalledOnce();
	});

	it("says when the animation cannot fit, even small", async () => {
		const tiny = { ...REQUEST, limits: { ...LIMITS, maxBytes: 1024 } };
		const { open } = openFake({ width: 128, height: 128, draw: noiseFrame });

		expect((await convert(open, tiny)).answer).toEqual({
			type: "error",
			message:
				"The animation does not fit in 1 KiB, even smaller and with fewer colors and frames. Shorten or simplify it and try again.",
		});
	});
});
