import { describe, expect, it, vi } from "vitest";

import type {
	ConversionMessage,
	ConversionProgress,
	ConversionRequest,
} from "../../src/lib/animationConversion.ts";
import { encodeApng, type FitAttempt } from "../../src/lib/apng.ts";
import {
	CANNOT_CONVERT,
	convertInWorker,
	encodeWithinLimit,
	stickerEncoder,
	type ConversionWorker,
} from "../../src/lib/stickerImage.ts";
import { extendedWebp, fakeWorker, gif, pngChunks, solidFrame } from "../support/animation.ts";
import { LIMITS } from "../support/api.ts";
import { stubImageDrawing } from "../support/drawing.ts";

type Encode = (quality: number) => Promise<Blob>;

const APNG = encodeApng([solidFrame(1, 64), solidFrame(2, 64)], 64, 256, [100, 100]);
const PROGRESS: ConversionProgress = { step: "decode", done: 1, total: 2 };
const ENCODING: FitAttempt = { size: 64, colors: 256, frames: 2, fps: 10 };
const ANIMATED_WEBP = new Blob([extendedWebp(["ANIM", "ANMF", "ANMF"])], { type: "image/webp" });

const drawing = stubImageDrawing();

function blobOf(size: number, type = "image/webp"): Blob {
	return new Blob([new Uint8Array(size)], { type });
}

function gifRequest(): ConversionRequest {
	return { bytes: gif(2).buffer, type: "image/gif", limits: LIMITS };
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

/** Encodes `image` with a worker that answers `answer`, drawing still images 512 pixels square. */
function encodeAnswering(image: Blob, answer: ConversionMessage) {
	drawing.decodeImage.mockResolvedValue({ width: 512, height: 512, close: vi.fn<() => void>() });
	const onFlattened = vi.fn<() => void>();
	const { worker } = fakeWorker(() => [answer]);
	const sticker = stickerEncoder(() => worker)(image, LIMITS, { onFlattened });
	return { sticker, onFlattened };
}

describe("stickerEncoder", () => {
	it("keeps an APNG that Signal takes as it is", async () => {
		const startWorker = vi.fn<() => ConversionWorker>();
		const image = new Blob([APNG], { type: "image/png" });

		const sticker = await stickerEncoder(startWorker)(image, LIMITS);

		expect(sticker).toBe(image);
		expect(startWorker).not.toHaveBeenCalled();
	});

	it.each([
		["a GIF", gif(2), "image/gif"],
		["an APNG Signal would reject", pngChunks({ width: 600, height: 400, plays: 0 }), "image/png"],
	])(
		"converts %s to APNG in a worker, reporting progress and the encoding",
		async (_, bytes, type) => {
			const { worker, requests } = fakeWorker(() => [
				{ type: "progress", progress: PROGRESS },
				{ type: "done", apng: APNG.slice().buffer, encoding: ENCODING },
			]);
			const onProgress = vi.fn<(progress: ConversionProgress) => void>();
			const onAnimated = vi.fn<(encoding: FitAttempt) => void>();

			const sticker = await stickerEncoder(() => worker)(new Blob([bytes]), LIMITS, {
				onProgress,
				onAnimated,
			});

			expect(sticker.type).toBe("image/png");
			expect(await bytesOf(sticker)).toEqual(APNG);
			expect(requests.map(({ request }) => [request.type, request.limits])).toEqual([
				[type, LIMITS],
			]);
			expect(onProgress).toHaveBeenCalledWith(PROGRESS);
			expect(onAnimated).toHaveBeenCalledWith(ENCODING);
		},
	);

	it.each([
		["keeps a still WebP", extendedWebp(["ALPH", "VP8 "]), true],
		["redraws a WebP animation of one frame", extendedWebp(["ANIM", "ANMF"]), false],
	])("%s that fits without the worker", async (_, bytes, kept) => {
		drawing.decodeImage.mockResolvedValue({ width: 512, height: 512, close: vi.fn<() => void>() });
		const startWorker = vi.fn<() => ConversionWorker>();
		const image = new Blob([bytes], { type: "image/webp" });

		const sticker = await stickerEncoder(startWorker)(image, LIMITS);

		expect([sticker === image, sticker.type]).toEqual([kept, "image/webp"]);
		expect(startWorker).not.toHaveBeenCalled();
	});

	it("draws a single frame animation as a still WebP, even when it fits", async () => {
		const { sticker, onFlattened } = encodeAnswering(ANIMATED_WEBP, { type: "still" });

		expect(await sticker).not.toBe(ANIMATED_WEBP);
		expect((await sticker).type).toBe("image/webp");
		expect(onFlattened).not.toHaveBeenCalled();
	});

	it("draws a GIF the browser cannot convert as a still WebP, and says so", async () => {
		const image = new Blob([gif(2)], { type: "image/gif" });
		const { sticker, onFlattened } = encodeAnswering(image, { type: "unsupported" });

		expect((await sticker).type).toBe("image/webp");
		expect(onFlattened).toHaveBeenCalledOnce();
	});

	it("refuses an animated WebP the browser cannot convert when it must animate", async () => {
		const { worker } = fakeWorker(() => [{ type: "unsupported" }]);

		const sticker = stickerEncoder(() => worker)(ANIMATED_WEBP, LIMITS, { mustAnimate: true });

		await expect(sticker).rejects.toThrow(CANNOT_CONVERT);
	});

	it("refuses an APNG the browser cannot convert, since Signal would reject it", async () => {
		const image = new Blob([pngChunks({ width: 600, height: 400, plays: 0 })]);
		const { sticker, onFlattened } = encodeAnswering(image, { type: "unsupported" });

		await expect(sticker).rejects.toThrow(CANNOT_CONVERT);
		expect(onFlattened).not.toHaveBeenCalled();
	});
});

describe("convertInWorker", () => {
	it("transfers the image to the worker and stops the worker once answered", async () => {
		const { worker, requests } = fakeWorker(() => [
			{ type: "done", apng: APNG.slice().buffer, encoding: ENCODING },
		]);
		const sent = gifRequest();

		await convertInWorker(worker, sent);

		expect(requests).toEqual([{ request: sent, transfer: [sent.bytes] }]);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("resolves the worker's answer when there is no APNG", async () => {
		const { worker } = fakeWorker(() => [{ type: "still" }]);

		await expect(convertInWorker(worker, gifRequest())).resolves.toEqual({ type: "still" });
	});

	it("rejects with the worker's explanation", async () => {
		const message = "Could not convert the animation: Corrupt frame";
		const { worker } = fakeWorker(() => [{ type: "error", message }]);

		await expect(convertInWorker(worker, gifRequest())).rejects.toThrow(message);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects and stops the worker when it fails to start", async () => {
		const { worker, fail } = fakeWorker(() => []);

		const converted = convertInWorker(worker, gifRequest());
		fail();

		await expect(converted).rejects.toThrow("The browser could not start converting the animation");
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it("rejects and stops the worker when the signal aborts", async () => {
		const { worker } = fakeWorker(() => []);
		const controller = new AbortController();

		const converted = convertInWorker(worker, gifRequest(), { signal: controller.signal });
		controller.abort(new Error("Canceled"));

		await expect(converted).rejects.toThrow("Canceled");
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});

describe("encodeWithinLimit", () => {
	it("lowers the quality until the image fits", async () => {
		const encode = vi.fn<Encode>((quality) => Promise.resolve(blobOf(quality * 1000)));

		const blob = await encodeWithinLimit(encode, { ...LIMITS, maxBytes: 600 }, [0.9, 0.7, 0.5]);

		expect(blob.size).toBe(500);
		expect(encode.mock.calls).toEqual([[0.9], [0.7], [0.5]]);
	});

	it("fails when even the lowest quality is too large", async () => {
		const encode = vi.fn<Encode>(() => Promise.resolve(blobOf(2048)));

		await expect(
			encodeWithinLimit(encode, { ...LIMITS, maxBytes: 1024 }, [0.9, 0.5]),
		).rejects.toThrow("The image does not fit in 1 KiB");
		expect(encode).toHaveBeenCalledTimes(2);
	});

	it("keeps the lossless PNG of a browser without a WebP encoder when it fits", async () => {
		const encode = vi.fn<Encode>(() => Promise.resolve(blobOf(1024, "image/png")));

		const blob = await encodeWithinLimit(encode, LIMITS);

		expect(blob.type).toBe("image/png");
	});

	it("explains what to do when the browser cannot encode WebP", async () => {
		const encode = vi.fn<Encode>(() => Promise.resolve(blobOf(LIMITS.maxBytes + 1, "image/png")));

		await expect(encodeWithinLimit(encode, LIMITS)).rejects.toThrow(
			"This browser cannot convert images to WebP, and as PNG this one is over 300 KiB. Add a 512×512 PNG or WebP image under 300 KiB, or use a browser that can, such as Chrome or Firefox.",
		);
		expect(encode).toHaveBeenCalledOnce();
	});
});
