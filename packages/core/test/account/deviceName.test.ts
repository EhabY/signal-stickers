import { PrivateKey } from "@signalapp/libsignal-client";
import { describe, expect, it } from "vitest";

import { encryptDeviceName } from "../../src/account/deviceName.ts";
import { decryptDeviceName, LINKED_ACCOUNT } from "../support/index.ts";

const sequence = (start: number) => Uint8Array.from({ length: 32 }, (_, i) => start + i);

// Computed independently with node:crypto (X25519, HMAC-SHA256, AES-256-CTR): identity key 41..60,
// ephemeral key 81..a0.
const ENCRYPTED_NAME =
	"CiEFiDGGuAC0HVzwQpaV2ps8xPMo680YSm5IL6V4wQPwbHcSEIuFVFxQfiKrBr8XAy71my0aD/fIFMFCGikoYIfUzxAO4g==";

describe("encryptDeviceName", () => {
	it("encrypts a known name", async () => {
		const identityKey = PrivateKey.deserialize(sequence(0x41)).getPublicKey();
		const ephemeralKey = PrivateKey.deserialize(sequence(0x81));

		const name = await encryptDeviceName("signal-stickers", identityKey, ephemeralKey);

		expect(name).toBe(ENCRYPTED_NAME);
	});

	it("round-trips with a fresh ephemeral key each time", async () => {
		const identityKey = LINKED_ACCOUNT.aciIdentityKey;

		const first = await encryptDeviceName("signal-stickers", identityKey.getPublicKey());
		const second = await encryptDeviceName("signal-stickers", identityKey.getPublicKey());

		expect(first).not.toBe(second);
		expect(decryptDeviceName(first, identityKey)).toBe("signal-stickers");
	});
});
