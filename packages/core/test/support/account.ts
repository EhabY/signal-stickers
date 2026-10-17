import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

import { PrivateKey, PublicKey } from "@signalapp/libsignal-client";

import type { Credentials, CredentialsStore } from "../../src/account/credentials.ts";
import type { SerializedPreKey } from "../../src/account/keys.ts";
import type { LinkProgress } from "../../src/account/link.ts";
import type {
	ProvisioningAck,
	ProvisioningListener,
	ProvisioningTransport,
} from "../../src/account/provisioningTransport.ts";
import {
	decodeDeviceName,
	encodeProvisionEnvelope,
	encodeProvisionMessage,
	type ProvisionMessageProto,
} from "../../src/protocol/provisioning.ts";

export const CREDENTIALS: Credentials = {
	env: "production",
	aci: "9d0652a3-dcc3-4d11-975f-74d61598733f",
	deviceId: 2,
	password: "device-password",
	createdAt: "2026-10-17T00:00:00.000Z",
};

export type MemoryCredentialsStore = CredentialsStore & { current(): Credentials | undefined };

/** A {@link CredentialsStore} that keeps credentials in memory, starting with `initial`. */
export function memoryCredentialsStore(initial?: Credentials): MemoryCredentialsStore {
	let saved = initial;
	return {
		path: "/config/signal-stickers/credentials.json",
		current: () => saved,
		load: () => Promise.resolve(saved),
		save: (credentials) => {
			saved = credentials;
			return Promise.resolve();
		},
		delete: () => {
			const existed = saved !== undefined;
			saved = undefined;
			return Promise.resolve(existed);
		},
	};
}

/** The account the fake phone links: {@link CREDENTIALS}' aci, with a phone number. */
export const LINKED_ACCOUNT = {
	aci: CREDENTIALS.aci,
	pni: "4f6a3b2c-1d0e-4f9a-8b7c-6d5e4f3a2b1c",
	number: "+15555550123",
	provisioningCode: "provisioning-code",
	aciIdentityKey: PrivateKey.deserialize(new Uint8Array(32).fill(0x41)),
	pniIdentityKey: PrivateKey.deserialize(new Uint8Array(32).fill(0x61)),
};

/** What the phone sends for {@link LINKED_ACCOUNT}. */
export const PROVISION_MESSAGE: ProvisionMessageProto = {
	aciIdentityKeyPrivate: LINKED_ACCOUNT.aciIdentityKey.serialize(),
	number: LINKED_ACCOUNT.number,
	provisioningCode: LINKED_ACCOUNT.provisioningCode,
	aci: LINKED_ACCOUNT.aci,
	pni: LINKED_ACCOUNT.pni,
	pniIdentityKeyPrivate: LINKED_ACCOUNT.pniIdentityKey.serialize(),
};

/** What the phone sends when the account links without sharing its phone number. */
export const PROVISION_MESSAGE_WITHOUT_NUMBER: ProvisionMessageProto = {
	...PROVISION_MESSAGE,
	number: undefined,
	pni: undefined,
	pniIdentityKeyPrivate: undefined,
};

/** The chat service's reply to `PUT /v1/devices/link` for {@link LINKED_ACCOUNT}. */
export const LINK_RESPONSE = { uuid: LINKED_ACCOUNT.aci, pni: LINKED_ACCOUNT.pni, deviceId: 3 };

export type FakeProvisioningSocket = {
	readonly address: string;
	readonly listener: ProvisioningListener;
	/** Status codes the client acknowledged, in order. */
	readonly acks: number[];
	disconnected: boolean;
};

export type FakeProvisioning = Readonly<{
	/** Pass as `provisioning`. */
	transport: ProvisioningTransport;
	sockets: readonly FakeProvisioningSocket[];
	/**
	 * Plays the phone scanning `qrUrl`: sends its socket the message encrypted to the code's key,
	 * then closes the socket like the server does once the client acknowledges it.
	 */
	scan(qrUrl: string): void;
	/** Pass as (or call from) `onProgress` to scan each QR code as soon as it is shown. */
	scanWhenShown(progress: LinkProgress): void;
	/** Drops `socket` like a network failure. */
	interrupt(socket: FakeProvisioningSocket): void;
}>;

export type FakeProvisioningOptions = Readonly<{
	/** Whether the server gives each socket its address; defaults to true. */
	sendAddress?: boolean | undefined;
	/** What the phone sends; defaults to {@link PROVISION_MESSAGE}. */
	message?: ProvisionMessageProto | undefined;
}>;

/** A provisioning service whose sockets connect at once; {@link FakeProvisioning.scan} plays the phone. */
export function fakeProvisioning({
	sendAddress = true,
	message = PROVISION_MESSAGE,
}: FakeProvisioningOptions = {}): FakeProvisioning {
	const sockets: FakeProvisioningSocket[] = [];
	const close = (socket: FakeProvisioningSocket, cause: Error | null) => {
		if (!socket.disconnected) {
			socket.disconnected = true;
			socket.listener.onConnectionInterrupted(cause);
		}
	};
	const scan = (qrUrl: string) => {
		const params = new URL(qrUrl).searchParams;
		const socket = sockets.find(({ address }) => address === params.get("uuid"));
		if (!socket || socket.disconnected) {
			throw new Error(`No open socket for ${qrUrl}`);
		}
		const publicKey = Buffer.from(params.get("pub_key") ?? "", "base64");
		const acked = socket.acks.length;
		socket.listener.onReceivedEnvelope(
			encryptProvisionEnvelope(message, publicKey),
			ackFor(socket),
		);
		if (socket.acks.length > acked) {
			close(socket, new Error("Closed by the server"));
		}
	};
	return {
		sockets,
		transport: (listener) => {
			const socket: FakeProvisioningSocket = {
				address: `provisioning-address-${sockets.length + 1}`,
				listener,
				acks: [],
				disconnected: false,
			};
			sockets.push(socket);
			if (sendAddress) {
				queueMicrotask(() => {
					listener.onReceivedAddress(socket.address, ackFor(socket));
				});
			}
			return Promise.resolve({
				disconnect: () => {
					close(socket, null);
					return Promise.resolve();
				},
			});
		},
		scan,
		scanWhenShown: (progress) => {
			if (progress.step === "waitingForScan") {
				scan(progress.qrUrl);
			}
		},
		interrupt: (socket) => {
			close(socket, new Error("Connection reset"));
		},
	};
}

/** Encrypts `message` to `publicKey` like the phone, the reverse of Signal's `ProvisioningCipher`. */
export function encryptProvisionEnvelope(
	message: ProvisionMessageProto,
	publicKey: Uint8Array,
): Uint8Array {
	const ephemeralKey = PrivateKey.generate();
	const sharedSecret = ephemeralKey.agree(PublicKey.deserialize(Uint8Array.from(publicKey)));
	const info = "TextSecure Provisioning Message";
	const keys = Buffer.from(hkdfSync("sha256", sharedSecret, new Uint8Array(32), info, 96));
	const iv = randomBytes(16);
	const cipher = createCipheriv("aes-256-cbc", keys.subarray(0, 32), iv);
	const plaintext = encodeProvisionMessage(message);
	const body = Buffer.concat([Uint8Array.of(1), iv, cipher.update(plaintext), cipher.final()]);
	return encodeProvisionEnvelope({
		publicKey: ephemeralKey.getPublicKey().serialize(),
		body: Buffer.concat([body, hmac(keys.subarray(32, 64), body)]),
	});
}

/** Signal Desktop's `decryptDeviceName`, to read the name a link request carries. */
export function decryptDeviceName(name: string, identityKey: PrivateKey): string {
	const { ephemeralPublic, syntheticIv, ciphertext } = decodeDeviceName(
		Buffer.from(name, "base64"),
	);
	const masterSecret = identityKey.agree(PublicKey.deserialize(Uint8Array.from(ephemeralPublic!)));
	const cipherKey = hmac(hmac(masterSecret, "cipher"), syntheticIv!);
	const decipher = createDecipheriv("aes-256-ctr", cipherKey, new Uint8Array(16));
	const plaintext = Buffer.concat([decipher.update(ciphertext!), decipher.final()]);
	const expectedIv = hmac(hmac(masterSecret, "auth"), plaintext).subarray(0, 16);
	if (!timingSafeEqual(expectedIv, syntheticIv!)) {
		throw new Error("Device name synthetic IV does not match");
	}
	return plaintext.toString();
}

/** Whether `identityKey` signed `preKey`, as the chat service checks. */
export function isSignedBy(identityKey: PrivateKey, { publicKey, signature }: SerializedPreKey) {
	return identityKey
		.getPublicKey()
		.verify(Buffer.from(publicKey, "base64"), Buffer.from(signature, "base64"));
}

function ackFor(socket: FakeProvisioningSocket): ProvisioningAck {
	return {
		send: (statusCode) => {
			socket.acks.push(statusCode);
		},
	};
}

function hmac(key: Uint8Array, data: Uint8Array | string): Buffer {
	return createHmac("sha256", key).update(data).digest();
}
