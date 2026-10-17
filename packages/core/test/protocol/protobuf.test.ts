import { describe, expect, it } from "vitest";

import {
	decodeStickerPack,
	encodeStickerPack,
	ProtobufError,
	ProtobufWriter,
	type StickerPackProto,
} from "../../src/protocol/protobuf.ts";

const PACK: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	cover: { id: 1 },
	stickers: [{ id: 0, emoji: "😀" }, { id: 1, emoji: "😾" }, {}],
};

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

describe("StickerPack", () => {
	it("encodes to the expected wire format", () => {
		const encoded = encodeStickerPack({ title: "A", stickers: [{ id: 0, emoji: "😀" }] });

		expect(Buffer.from(encoded).toString("hex")).toBe(
			["0a0141", "2208", "0800", "1204f09f9880"].join(""),
		);
	});

	it("round-trips", () => {
		expect(decodeStickerPack(encodeStickerPack(PACK))).toEqual(PACK);
	});

	it("omits unset fields", () => {
		expect(encodeStickerPack({ stickers: [] })).toHaveLength(0);
	});

	it("skips unknown fields of every wire type", () => {
		const unknown = new ProtobufWriter().uint32(9, 7).string(10, "x").finish();
		const fixed64 = bytes("59" + "00".repeat(8));
		const fixed32 = bytes("5d" + "00".repeat(4));

		const decoded = decodeStickerPack(
			Buffer.concat([unknown, fixed64, encodeStickerPack(PACK), fixed32]),
		);

		expect(decoded).toEqual(PACK);
	});

	it("keeps the last cover like Signal", () => {
		const encoded = Buffer.concat([
			encodeStickerPack({ cover: { id: 3 }, stickers: [] }),
			encodeStickerPack({ cover: { emoji: "🐱" }, stickers: [] }),
		]);

		expect(decodeStickerPack(encoded).cover).toEqual({ emoji: "🐱" });
	});

	it("keeps a leading byte order mark", () => {
		expect(decodeStickerPack(bytes("0a04efbbbf41")).title).toBe("﻿A");
	});

	it("encodes large payloads", () => {
		const encoded = new ProtobufWriter().bytes(1, new Uint8Array(1_000_000)).finish();

		expect(encoded.length).toBe(1_000_004);
	});

	it.each([
		["a truncated varint", "08"],
		["an overlong varint", "08" + "80".repeat(10) + "01"],
		["a truncated length-delimited field", "0a0541"],
		["a truncated fixed64 field", "59" + "00".repeat(7)],
		["field number 0", "0001"],
		["a group wire type", "0b"],
		["a varint where a string is expected", "0801"],
	])("rejects %s", (_, hex) => {
		expect(() => decodeStickerPack(bytes(hex))).toThrow(ProtobufError);
	});

	it("rejects values that are not uint32", () => {
		expect(() => encodeStickerPack({ stickers: [{ id: -1 }] })).toThrow(ProtobufError);
	});
});
