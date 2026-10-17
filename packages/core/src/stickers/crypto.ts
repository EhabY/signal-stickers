import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

export class DecryptionError extends Error {
	override name = "DecryptionError";
}

export const PACK_KEY_SIZE = 32;
const IV_SIZE = 16;
const MAC_SIZE = 32;

export type PackKeys = Readonly<{ aesKey: Uint8Array; macKey: Uint8Array }>;

export function derivePackKeys(packKey: Uint8Array): PackKeys {
	if (packKey.length !== PACK_KEY_SIZE) {
		throw new RangeError(`Pack key must be ${PACK_KEY_SIZE} bytes`);
	}
	const keys = new Uint8Array(hkdfSync("sha256", packKey, new Uint8Array(32), "Sticker Pack", 64));
	return { aesKey: keys.subarray(0, 32), macKey: keys.subarray(32) };
}

/** Returns `iv || AES-256-CBC(plaintext) || HMAC-SHA256(iv || ciphertext)`. */
export function encryptAttachment(plaintext: Uint8Array, { aesKey, macKey }: PackKeys): Uint8Array {
	const iv = randomBytes(IV_SIZE);
	const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
	const body = Buffer.concat([iv, cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([body, hmac(macKey, body)]);
}

export function decryptAttachment(data: Uint8Array, { aesKey, macKey }: PackKeys): Uint8Array {
	if (data.length < IV_SIZE + MAC_SIZE) {
		throw new DecryptionError("Attachment is too short");
	}
	const body = data.subarray(0, -MAC_SIZE);
	if (!timingSafeEqual(hmac(macKey, body), data.subarray(-MAC_SIZE))) {
		throw new DecryptionError("Attachment MAC does not match");
	}
	try {
		const decipher = createDecipheriv("aes-256-cbc", aesKey, body.subarray(0, IV_SIZE));
		return Buffer.concat([decipher.update(body.subarray(IV_SIZE)), decipher.final()]);
	} catch (error) {
		throw new DecryptionError("Attachment could not be decrypted", { cause: error });
	}
}

function hmac(key: Uint8Array, data: Uint8Array): Buffer {
	return createHmac("sha256", key).update(data).digest();
}
