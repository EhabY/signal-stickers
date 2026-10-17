import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	DecryptionError,
	decryptAttachment,
	derivePackKeys,
	encryptAttachment,
} from "../../src/stickers/crypto.ts";

// Known answers computed independently with OpenSSL 3 (`openssl kdf HKDF`,
// `openssl enc -aes-256-cbc`, `openssl dgst -mac HMAC`).
const KEYS = derivePackKeys(Buffer.alloc(32, 1));
const DERIVED_KEYS = [
	[
		"01".repeat(32),
		"4478c108f0f562c9a96276220107fe5bf2e0065544c3c4a8fe7916c2fe314f76",
		"42cb60019f4d53d629f4c47b50b1d4ccda4b33f22117ac8510fd6ecc16f42518",
	],
	[
		"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
		"64f46fd204462c27c05dd6f5db863edd9f286af100e5e9704efdd36ce89583ff",
		"c483e5dfa58b86e9a7a2245b775677f5f6864b94f2302dcec6636f713de6de65",
	],
];
const ENCRYPTED = Buffer.from(
	"000102030405060708090a0b0c0d0e0f72c2ab47b4d5036916b6168a5fa78c30" +
		"c931b94a151a1f88c5e2f8a34407a1ea672c873e849a56007b5251b75a8b88cf",
	"hex",
);

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

function tampered(index: number): Buffer {
	const copy = Buffer.from(ENCRYPTED);
	copy[index] = (copy[index] ?? 0) ^ 1;
	return copy;
}

describe("pack crypto", () => {
	it.each(DERIVED_KEYS)("derives keys for %s with HKDF-SHA256", (packKey, aesKey, macKey) => {
		const keys = derivePackKeys(Buffer.from(packKey, "hex"));

		expect({ aesKey: hex(keys.aesKey), macKey: hex(keys.macKey) }).toEqual({ aesKey, macKey });
	});

	it("rejects pack keys that are not 32 bytes", () => {
		expect(() => derivePackKeys(Buffer.alloc(16))).toThrow(RangeError);
	});

	it("decrypts a known attachment", () => {
		expect(text(decryptAttachment(ENCRYPTED, KEYS))).toBe("hello sticker");
	});

	it("round-trips with a fresh IV each time", () => {
		const plaintext = Buffer.from("cat");

		const first = encryptAttachment(plaintext, KEYS);
		const second = encryptAttachment(plaintext, KEYS);

		expect(hex(first.subarray(0, 16))).not.toBe(hex(second.subarray(0, 16)));
		expect(decryptAttachment(first, KEYS)).toEqual(plaintext);
	});

	it.each([
		["IV", 0],
		["ciphertext", 20],
		["MAC", ENCRYPTED.length - 1],
	])("rejects a tampered %s", (_, index) => {
		expect(() => decryptAttachment(tampered(index), KEYS)).toThrow(DecryptionError);
	});

	it("rejects a valid MAC over ciphertext that does not decrypt", () => {
		const body = Buffer.concat([Buffer.alloc(16), Buffer.alloc(16, 0xff)]);
		const mac = createHmac("sha256", KEYS.macKey).update(body).digest();

		expect(() => decryptAttachment(Buffer.concat([body, mac]), KEYS)).toThrow(
			"Attachment could not be decrypted",
		);
	});

	it("rejects attachments shorter than an IV and MAC", () => {
		expect(() => decryptAttachment(ENCRYPTED.subarray(0, 47), KEYS)).toThrow(DecryptionError);
	});
});
