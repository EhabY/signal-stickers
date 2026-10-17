import { describe, expect, it } from "vitest";

import { sniffImageFormat } from "../../src/stickers/image.ts";
import { png } from "../support/index.ts";

describe("sniffImageFormat", () => {
	it.each([
		["png", png(0), "png"],
		["webp", Buffer.from("RIFFsizeWEBPVP8 "), "webp"],
		["other RIFF", Buffer.from("RIFFsizeWAVEfmt "), undefined],
		["gif", Buffer.from("GIF89a"), undefined],
		["empty", new Uint8Array(), undefined],
	])("detects %s", (_, bytes, format) => {
		expect(sniffImageFormat(bytes)).toBe(format);
	});
});
