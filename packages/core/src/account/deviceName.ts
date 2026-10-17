import { createCipheriv } from "node:crypto";

import type { PrivateKey, PublicKey } from "@signalapp/libsignal-client";

import { encodeDeviceName } from "../protocol/provisioning.ts";
import { hmacSha256 } from "../util/hmacSha256.ts";
import { loadLibsignal } from "./libsignal.ts";

/**
 * Encrypts `name` to the account's identity key, so only its devices can read it, and returns the
 * base64 `DeviceName` the chat service stores. Ported from Signal Desktop's `encryptDeviceName`;
 * tests pass a fixed `ephemeralKey`.
 */
export async function encryptDeviceName(
	name: string,
	identityKey: PublicKey,
	ephemeralKey?: PrivateKey,
): Promise<string> {
	const ephemeral = ephemeralKey ?? (await loadLibsignal()).PrivateKey.generate();
	const plaintext = Buffer.from(name);
	const masterSecret = ephemeral.agree(identityKey);
	const syntheticIv = hmacSha256(hmacSha256(masterSecret, "auth"), plaintext).subarray(0, 16);
	const cipherKey = hmacSha256(hmacSha256(masterSecret, "cipher"), syntheticIv);
	const cipher = createCipheriv("aes-256-ctr", cipherKey, new Uint8Array(16));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const encoded = encodeDeviceName({
		ephemeralPublic: ephemeral.getPublicKey().serialize(),
		syntheticIv,
		ciphertext,
	});
	return Buffer.from(encoded).toString("base64");
}
