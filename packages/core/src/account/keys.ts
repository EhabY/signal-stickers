import { randomBytes, randomInt } from "node:crypto";

import type { PrivateKey } from "@signalapp/libsignal-client";

import { loadLibsignal } from "./libsignal.ts";

/** A signed prekey as the chat service takes it, like Signal Desktop's `serializeSignedPreKey`. */
export type SerializedPreKey = Readonly<{ keyId: number; publicKey: string; signature: string }>;

/** The prekeys a new device uploads for one identity (ACI or PNI). */
export type PreKeys = Readonly<{
	signedPreKey: SerializedPreKey;
	pqLastResortPreKey: SerializedPreKey;
}>;

// Signal Desktop starts a fresh device's key ids at a random 24-bit value.
const KEY_ID_LIMIT = 0x1000000;

/** 1 to 16383, like Signal Desktop's `generateRegistrationId`. */
export function generateRegistrationId(): number {
	return randomInt(1, 16384);
}

/** 16 random bytes in base64 without the trailing `==`, like Signal Desktop. */
export function generatePassword(): string {
	return randomBytes(16).toString("base64").slice(0, -2);
}

/** A signed EC prekey and a signed last-resort Kyber prekey, both signed by `identityKey`. */
export async function generatePreKeys(identityKey: PrivateKey): Promise<PreKeys> {
	const { KEMKeyPair, PrivateKey } = await loadLibsignal();
	const ecPublicKey = PrivateKey.generate().getPublicKey().serialize();
	const kyberPublicKey = KEMKeyPair.generate().getPublicKey().serialize();
	return {
		signedPreKey: serializePreKey({
			keyId: randomInt(KEY_ID_LIMIT),
			publicKey: ecPublicKey,
			signature: identityKey.sign(ecPublicKey),
		}),
		pqLastResortPreKey: serializePreKey({
			keyId: randomInt(KEY_ID_LIMIT),
			publicKey: kyberPublicKey,
			signature: identityKey.sign(kyberPublicKey),
		}),
	};
}

function serializePreKey({
	keyId,
	publicKey,
	signature,
}: Readonly<{ keyId: number; publicKey: Uint8Array; signature: Uint8Array }>): SerializedPreKey {
	return {
		keyId,
		publicKey: Buffer.from(publicKey).toString("base64"),
		signature: Buffer.from(signature).toString("base64"),
	};
}
