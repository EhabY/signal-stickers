import type { Environment } from "../env.ts";
import { NotImplementedError } from "../util/notImplemented.ts";

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
export function createProvisioningTransport(_env: Environment): ProvisioningTransport {
	throw new NotImplementedError("createProvisioningTransport");
}
