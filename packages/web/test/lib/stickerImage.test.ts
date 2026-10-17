import { describe, expect, it, vi } from "vitest";

import { encodeWithinLimit, fitInSquare } from "../../src/lib/stickerImage.ts";

type Encode = (quality: number) => Promise<Blob>;

function blobOf(size: number, type = "image/webp"): Blob {
	return new Blob([new Uint8Array(size)], { type });
}

describe("fitInSquare", () => {
	it.each([
		["a wide image", { width: 1024, height: 512 }, { x: 0, y: 128, width: 512, height: 256 }],
		["a tall image", { width: 100, height: 400 }, { x: 192, y: 0, width: 128, height: 512 }],
		["a small square", { width: 64, height: 64 }, { x: 0, y: 0, width: 512, height: 512 }],
	])("centers %s", (_, image, rect) => {
		expect(fitInSquare(image, 512)).toEqual(rect);
	});
});

describe("encodeWithinLimit", () => {
	it("lowers the quality until the image fits", async () => {
		const encode = vi.fn<Encode>((quality) => Promise.resolve(blobOf(quality * 1000)));

		const blob = await encodeWithinLimit(encode, 600, [0.9, 0.7, 0.5]);

		expect(blob.size).toBe(500);
		expect(encode.mock.calls).toEqual([[0.9], [0.7], [0.5]]);
	});

	it("fails when even the lowest quality is too large", async () => {
		const encode = vi.fn<Encode>(() => Promise.resolve(blobOf(2048)));

		await expect(encodeWithinLimit(encode, 1024, [0.9, 0.5])).rejects.toThrow(
			"The image does not fit in 1 KiB",
		);
		expect(encode).toHaveBeenCalledTimes(2);
	});

	it("stops when the browser can only encode lossless PNG", async () => {
		const encode = vi.fn<Encode>(() => Promise.resolve(blobOf(2048, "image/png")));

		await expect(encodeWithinLimit(encode, 1024)).rejects.toThrow("does not fit");
		expect(encode).toHaveBeenCalledOnce();
	});
});
