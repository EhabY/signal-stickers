import { createDecipheriv, hkdfSync, timingSafeEqual } from "node:crypto";

import type { PrivateKey } from "@signalapp/libsignal-client";

import {
	decodeProvisionEnvelope,
	decodeProvisionMessage,
	type ProvisionMessageProto,
} from "../protocol/provisioning.ts";
import { DecryptionError } from "../stickers/crypto.ts";
import { hmacSha256 } from "../util/hmacSha256.ts";
import { loadLibsignal, type Libsignal } from "./libsignal.ts";
import { LinkError } from "./linkError.ts";

/** What the phone shares to link this device. The keys and provisioning code are secrets. */
export type ProvisionedAccount = Readonly<{
	aci: string;
	aciIdentityKey: PrivateKey;
	provisioningCode: string;
	/** Absent when the phone links without sharing its phone number. */
	phoneNumber?: Readonly<{ number: string; pni: string; pniIdentityKey: PrivateKey }> | undefined;
}>;

export type ProvisioningCipher = Readonly<{
	/** The QR code's key: serialized with its type byte, 33 bytes. */
	publicKey: Uint8Array;
	/** Decrypts a serialized `ProvisionEnvelope` sent to {@link publicKey}. */
	decrypt(envelope: Uint8Array): ProvisionedAccount;
}>;

const VERSION = 1;
const IV_SIZE = 16;
const MAC_SIZE = 32;
const KEY_SIZE = 32;

/**
 * Ported from Signal Desktop's `ProvisioningCipher`. Each QR code gets its own cipher; tests pass a
 * fixed `privateKey`.
 */
export async function createProvisioningCipher(
	privateKey?: PrivateKey,
): Promise<ProvisioningCipher> {
	const libsignal = await loadLibsignal();
	const ourKey = privateKey ?? libsignal.PrivateKey.generate();
	return {
		publicKey: ourKey.getPublicKey().serialize(),
		decrypt: (bytes) => {
			const { publicKey, body } = decodeProvisionEnvelope(bytes);
			if (!publicKey || !body) {
				throw new DecryptionError("Provisioning envelope is missing its key or body");
			}
			const sharedSecret = ourKey.agree(
				libsignal.PublicKey.deserialize(Uint8Array.from(publicKey)),
			);
			const message = decodeProvisionMessage(decryptBody(body, sharedSecret));
			return readProvisionedAccount(message, libsignal);
		},
	};
}

/** `body` is `version || iv || AES-256-CBC ciphertext || HMAC-SHA256` over everything before it. */
function decryptBody(body: Uint8Array, sharedSecret: Uint8Array): Uint8Array {
	if (body[0] !== VERSION) {
		throw new DecryptionError("Provisioning message has an unknown version");
	}
	if (body.length < 1 + IV_SIZE + MAC_SIZE) {
		throw new DecryptionError("Provisioning message is too short");
	}
	const keys = new Uint8Array(
		hkdfSync("sha256", sharedSecret, new Uint8Array(32), "TextSecure Provisioning Message", 96),
	);
	const cipherKey = keys.subarray(0, KEY_SIZE);
	const macKey = keys.subarray(KEY_SIZE, 2 * KEY_SIZE);
	const versionIvAndCiphertext = body.subarray(0, -MAC_SIZE);
	const mac = hmacSha256(macKey, versionIvAndCiphertext);
	if (!timingSafeEqual(mac, body.subarray(-MAC_SIZE))) {
		throw new DecryptionError("Provisioning message MAC does not match");
	}
	try {
		const iv = body.subarray(1, 1 + IV_SIZE);
		const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
		return Buffer.concat([
			decipher.update(versionIvAndCiphertext.subarray(1 + IV_SIZE)),
			decipher.final(),
		]);
	} catch (error) {
		throw new DecryptionError("Provisioning message could not be decrypted", { cause: error });
	}
}

/** Checks the message like Signal Desktop's `decrypt` and `prepareLinkData`. */
function readProvisionedAccount(
	message: ProvisionMessageProto,
	{ Aci, Pni, PrivateKey }: Libsignal,
): ProvisionedAccount {
	const identityKey = (bytes: Uint8Array): PrivateKey => {
		if (bytes.length !== KEY_SIZE) {
			throw new LinkError(`The phone sent an identity key that is not ${KEY_SIZE} bytes`);
		}
		return PrivateKey.deserialize(Uint8Array.from(bytes));
	};
	const { aciIdentityKeyPrivate } = message;
	const aci = hasBytes(message.aciBinary)
		? Aci.fromUuidBytes(message.aciBinary).getServiceIdString()
		: nonEmpty(message.aci)?.toLowerCase();
	const pni = hasBytes(message.pniBinary)
		? Pni.fromUuidBytes(message.pniBinary).getRawUuid()
		: nonEmpty(message.pni)?.toLowerCase();
	const pniIdentityKey = hasBytes(message.pniIdentityKeyPrivate)
		? identityKey(message.pniIdentityKeyPrivate)
		: undefined;
	const number = nonEmpty(message.number);
	const provisioningCode = nonEmpty(message.provisioningCode);
	const phoneNumber =
		pni !== undefined && pniIdentityKey !== undefined && number !== undefined
			? { number, pni, pniIdentityKey }
			: undefined;
	const partialPhoneNumber = !phoneNumber && (pni !== undefined || pniIdentityKey !== undefined);
	if (
		aci === undefined ||
		aciIdentityKeyPrivate === undefined ||
		provisioningCode === undefined ||
		partialPhoneNumber
	) {
		throw new LinkError("The phone sent incomplete linking data. Scan a new QR code.");
	}
	return { aci, aciIdentityKey: identityKey(aciIdentityKeyPrivate), provisioningCode, phoneNumber };
}

function hasBytes(bytes: Uint8Array | undefined): bytes is Uint8Array {
	return bytes !== undefined && bytes.length > 0;
}

function nonEmpty(text: string | undefined): string | undefined {
	return text === "" ? undefined : text;
}
