import type { Environment } from "../env.ts";
import type { ChatClientFactory } from "../net/chat.ts";
import { NotImplementedError } from "../util/notImplemented.ts";
import type { Credentials } from "./credentials.ts";
import type { ProvisioningTransport } from "./provisioningTransport.ts";

/**
 * Linking steps in order. `waitingForScan` repeats with a new QR URL if the provisioning socket is
 * reopened. Progress never carries secrets, so front ends may forward it as is.
 */
export type LinkProgress = Readonly<
	| { step: "connecting" }
	| { step: "waitingForScan"; qrUrl: string }
	| { step: "registering" }
	| { step: "done" }
>;

export type LinkOptions = Readonly<{
	env: Environment;
	/** Defaults to `createProvisioningTransport(env)`. */
	provisioning?: ProvisioningTransport | undefined;
	/** Defaults to `createChatClient`. */
	createChat?: ChatClientFactory | undefined;
	signal?: AbortSignal | undefined;
	onProgress?: ((progress: LinkProgress) => void) | undefined;
}>;

/** What front ends may show about the link: never the password. */
export type LinkStatus = Readonly<
	| { linked: false }
	| {
			linked: true;
			env: Environment;
			aci: string;
			deviceId: number;
			number?: string | undefined;
			createdAt: string;
	  }
>;

export type UnlinkOptions = Readonly<{
	credentials: Credentials;
	/** Defaults to `createChatClient`. */
	createChat?: ChatClientFactory | undefined;
	signal?: AbortSignal | undefined;
}>;

/**
 * Links this tool as a new device of the account whose phone scans the QR code, named
 * `signal-stickers`, and returns its credentials. The caller saves them.
 */
export function linkDevice(_options: LinkOptions): Promise<Credentials> {
	return Promise.reject(new NotImplementedError("linkDevice"));
}

export function getLinkStatus(credentials?: Credentials): LinkStatus {
	if (!credentials) {
		return { linked: false };
	}
	const { env, aci, deviceId, number, createdAt } = credentials;
	return { linked: true, env, aci, deviceId, number, createdAt };
}

/**
 * Removes this device from the account (`DELETE /v1/devices/{deviceId}`). A device the phone
 * already removed counts as unlinked. The caller deletes the stored credentials.
 */
export function unlinkDevice(_options: UnlinkOptions): Promise<void> {
	return Promise.reject(new NotImplementedError("unlinkDevice"));
}
