import { describe, expect, it } from "vitest";

import { fitInSquare } from "../../src/lib/square.ts";

describe("fitInSquare", () => {
	it.each([
		["a wide image", { width: 1024, height: 512 }, { x: 0, y: 128, width: 512, height: 256 }],
		["a tall image", { width: 100, height: 400 }, { x: 192, y: 0, width: 128, height: 512 }],
		["a small square", { width: 64, height: 64 }, { x: 0, y: 0, width: 512, height: 512 }],
	])("centers %s", (_, image, rect) => {
		expect(fitInSquare(image, 512)).toEqual(rect);
	});
});
