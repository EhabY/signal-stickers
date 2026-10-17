import type { Net } from "@signalapp/libsignal-client/dist/net.js";

import type { Environment } from "../env.ts";

/** Acknowledges a provisioning message, like libsignal's `ChatServerMessageAck`. */
export type ProvisioningAck = Readonly<{ send(statusCode: number): void }>;

/** Mirrors libsignal's `ProvisioningConnectionListener`. */
export type ProvisioningListener = Readonly<{
	/** `address` is the opaque token that goes into the QR code. */
	onReceivedAddress(address: string, ack: ProvisioningAck): void;
	/** `envelope` is a serialized `ProvisionEnvelope`; the server closes the socket after the ack. */
	onReceivedEnvelope(envelope: Uint8Array, ack: ProvisioningAck): void;
	/** `cause` is null after a deliberate disconnect. */
	onConnectionInterrupted(cause: Error | null): void;
}>;

export type ProvisioningConnection = Readonly<{ disconnect(): Promise<void> }>;

/** Opens a provisioning socket, like libsignal's `Net.connectProvisioning`; tests pass a fake. */
export type ProvisioningTransport = (
	listener: ProvisioningListener,
	signal?: AbortSignal,
) => Promise<ProvisioningConnection>;

/** The real transport: libsignal's `Net` for `env`, which pins Signal's servers itself. */
export function createProvisioningTransport(env: Environment): ProvisioningTransport {
	let net: Promise<Net> | undefined;
	return async (listener, signal) => {
		net ??= createNet(env);
		return (await net).connectProvisioning(listener, signal ? { abortSignal: signal } : {});
	};
}

async function createNet(env: Environment): Promise<Net> {
	// Loaded on first use, like the rest of libsignal (see loadLibsignal).
	const libsignalNet = await import("@signalapp/libsignal-client/dist/net.js");
	const environments = {
		production: libsignalNet.Environment.Production,
		staging: libsignalNet.Environment.Staging,
	} satisfies Record<Environment, unknown>;
	return new libsignalNet.Net({ env: environments[env], userAgent: "signal-stickers" });
}
