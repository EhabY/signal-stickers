import { PrivateKey } from "@signalapp/libsignal-client";
import { describe, expect, it } from "vitest";

import { LinkError } from "../../src/account/linkError.ts";
import {
	createProvisioningCipher,
	type ProvisionedAccount,
} from "../../src/account/provisioningCipher.ts";
import type { ProvisionMessageProto } from "../../src/protocol/provisioning.ts";
import { DecryptionError } from "../../src/stickers/crypto.ts";
import {
	encryptProvisionEnvelope,
	LINKED_ACCOUNT,
	PROVISION_MESSAGE,
	PROVISION_MESSAGE_WITHOUT_NUMBER,
} from "../support/index.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const sequence = (start: number) => Uint8Array.from({ length: 32 }, (_, i) => start + i);
const uuidBytes = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex");

// Computed independently with node:crypto (X25519, HKDF-SHA256, AES-256-CBC, HMAC-SHA256): our key
// is 01..20, the phone's ephemeral key 21..40, the IV 00..0f. The message carries the identity keys
// 41..60 (ACI) and 61..80 (PNI), an uppercase aci, and a profile key that linking ignores.
const PROVISIONING_KEY = PrivateKey.deserialize(sequence(0x01));
const PROVISIONING_PUBLIC_KEY =
	"0507a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c";
const ENVELOPE = Buffer.from(
	"0a21055869aff450549732cbaaed5e5df9b30a6da31cb0e5742bad5ad4a1a768f1a67b12910201000102030405" +
		"060708090a0b0c0d0e0f9a754de03cc69b808b3240d332dc93991d08058d9240b4954b3f5c354b6fdd8c7377f8" +
		"30c91981c9972ceec17d8ec99cc442fdb03b590a86a034d3301330c51d59b537cd43a6f6f112e2644c1690751e" +
		"99e1cdb5b879b09e2dea74c332c8e73886338d4f86b46ffeb279f52e2ef9c3aa57438c069c99e43470d391b2d0" +
		"dced05afaac2a38b8227c0d0fc429da9f41867c8d284382f2b531272ed2e7003753b167ac43c5ef769879979e5" +
		"ac50f00913d0be22956a54b03c09d88fe4782f9a6cd882132ee6502faf240d02ae97ab39a031d28ce250241859" +
		"847238fa1db1513f30f44c4a2f8a13c195af9f3e8cd9a85ba8c018774dc86f9c8d3810c49d94b0d800",
	"hex",
);
// `0a 21 <33-byte key> 12 91 02` precede the body.
const BODY_OFFSET = 38;

/** The account with its keys as hex, so it compares with `toEqual`. */
function describeAccount({ aciIdentityKey, phoneNumber, ...rest }: ProvisionedAccount) {
	return {
		...rest,
		aciIdentityKey: hex(aciIdentityKey.serialize()),
		phoneNumber: phoneNumber && {
			...phoneNumber,
			pniIdentityKey: hex(phoneNumber.pniIdentityKey.serialize()),
		},
	};
}

async function decryptFromPhone(message: ProvisionMessageProto) {
	const cipher = await createProvisioningCipher();
	return cipher.decrypt(encryptProvisionEnvelope(message, cipher.publicKey));
}

function tampered(index: number): Buffer {
	const copy = Buffer.from(ENVELOPE);
	copy[index] = (copy[index] ?? 0) ^ 1;
	return copy;
}

describe("createProvisioningCipher", () => {
	it("puts its public key with the type byte in the QR code", async () => {
		const cipher = await createProvisioningCipher(PROVISIONING_KEY);

		expect(hex(cipher.publicKey)).toBe(PROVISIONING_PUBLIC_KEY);
	});

	it("decrypts a known envelope", async () => {
		const cipher = await createProvisioningCipher(PROVISIONING_KEY);

		const account = cipher.decrypt(ENVELOPE);

		// libsignal clamps the X25519 keys, as Signal Desktop's `createKeyPair` expects.
		expect(describeAccount(account)).toEqual({
			aci: "9d0652a3-dcc3-4d11-975f-74d61598733f",
			aciIdentityKey: "4042434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60",
			provisioningCode: "provisioning-code",
			phoneNumber: {
				number: "+15555550123",
				pni: "4f6a3b2c-1d0e-4f9a-8b7c-6d5e4f3a2b1c",
				pniIdentityKey: "6062636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f40",
			},
		});
	});

	it("generates a fresh key for each cipher", async () => {
		const [first, second] = await Promise.all([
			createProvisioningCipher(),
			createProvisioningCipher(),
		]);

		expect(hex(first.publicKey)).not.toBe(hex(second.publicKey));
	});

	it("round-trips what the phone sends", async () => {
		const account = await decryptFromPhone(PROVISION_MESSAGE);

		expect(describeAccount(account)).toEqual({
			aci: LINKED_ACCOUNT.aci,
			aciIdentityKey: hex(LINKED_ACCOUNT.aciIdentityKey.serialize()),
			provisioningCode: LINKED_ACCOUNT.provisioningCode,
			phoneNumber: {
				number: LINKED_ACCOUNT.number,
				pni: LINKED_ACCOUNT.pni,
				pniIdentityKey: hex(LINKED_ACCOUNT.pniIdentityKey.serialize()),
			},
		});
	});

	it("reads the binary aci and pni when present", async () => {
		const account = await decryptFromPhone({
			...PROVISION_MESSAGE,
			aci: "ignored",
			pni: "ignored",
			aciBinary: uuidBytes(LINKED_ACCOUNT.aci),
			pniBinary: uuidBytes(LINKED_ACCOUNT.pni),
		});

		expect(account.aci).toBe(LINKED_ACCOUNT.aci);
		expect(account.phoneNumber?.pni).toBe(LINKED_ACCOUNT.pni);
	});

	it("links without a phone number when the phone shares none", async () => {
		const account = await decryptFromPhone(PROVISION_MESSAGE_WITHOUT_NUMBER);

		expect(account.phoneNumber).toBeUndefined();
	});

	it.each([
		["version", BODY_OFFSET],
		["IV", BODY_OFFSET + 1],
		["ciphertext", BODY_OFFSET + 20],
		["MAC", ENVELOPE.length - 1],
	])("rejects a tampered %s", async (_, index) => {
		const cipher = await createProvisioningCipher(PROVISIONING_KEY);

		expect(() => cipher.decrypt(tampered(index))).toThrow(DecryptionError);
	});

	it("rejects an envelope sent to another key", async () => {
		const cipher = await createProvisioningCipher();

		expect(() => cipher.decrypt(ENVELOPE)).toThrow("Provisioning message MAC does not match");
	});

	it.each([
		["no aci", { aci: undefined }],
		["no aci identity key", { aciIdentityKeyPrivate: undefined }],
		["a short aci identity key", { aciIdentityKeyPrivate: new Uint8Array(31) }],
		["no provisioning code", { provisioningCode: "" }],
		["a pni without its identity key", { pniIdentityKeyPrivate: undefined }],
		["a pni without a phone number", { number: undefined }],
		["a pni identity key without a pni", { pni: undefined }],
	])("rejects linking data with %s", async (_, change) => {
		await expect(decryptFromPhone({ ...PROVISION_MESSAGE, ...change })).rejects.toThrow(LinkError);
	});
});
