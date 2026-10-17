import { KEMPublicKey, PublicKey } from "@signalapp/libsignal-client";
import { describe, expect, it } from "vitest";

import {
	generatePassword,
	generatePreKeys,
	generateRegistrationId,
} from "../../src/account/keys.ts";
import { isSignedBy, LINKED_ACCOUNT } from "../support/index.ts";

const fromBase64 = (text: string) => Uint8Array.from(Buffer.from(text, "base64"));
const sample = <T>(generate: () => T) => Array.from({ length: 200 }, generate);
const isKeyId = (keyId: number) => Number.isInteger(keyId) && keyId >= 0 && keyId < 2 ** 24;

describe("generateRegistrationId", () => {
	it("returns integers from 1 to 16383", () => {
		const ids = sample(generateRegistrationId);

		expect(ids.every((id) => Number.isInteger(id))).toBe(true);
		expect(Math.min(...ids)).toBeGreaterThanOrEqual(1);
		expect(Math.max(...ids)).toBeLessThanOrEqual(16_383);
	});
});

describe("generatePassword", () => {
	it("returns 16 random bytes in base64 without the padding", () => {
		const passwords = sample(generatePassword);

		expect(passwords.every((password) => /^[A-Za-z0-9+/]{22}$/u.test(password))).toBe(true);
		expect(fromBase64(`${passwords[0]}==`)).toHaveLength(16);
		expect(new Set(passwords).size).toBe(passwords.length);
	});
});

describe("generatePreKeys", () => {
	const identityKey = LINKED_ACCOUNT.aciIdentityKey;

	it("signs an EC prekey with the identity key", async () => {
		const { signedPreKey } = await generatePreKeys(identityKey);

		expect(PublicKey.deserialize(fromBase64(signedPreKey.publicKey)).serialize()).toHaveLength(33);
		expect(isSignedBy(identityKey, signedPreKey)).toBe(true);
		expect(isKeyId(signedPreKey.keyId)).toBe(true);
	});

	it("signs a last-resort Kyber prekey with the identity key", async () => {
		const { pqLastResortPreKey } = await generatePreKeys(identityKey);

		const kyberKey = KEMPublicKey.deserialize(fromBase64(pqLastResortPreKey.publicKey));

		expect(kyberKey.serialize()).toHaveLength(1569);
		expect(isSignedBy(identityKey, pqLastResortPreKey)).toBe(true);
		expect(isKeyId(pqLastResortPreKey.keyId)).toBe(true);
	});
});
