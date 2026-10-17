import type { Environment } from "../env.ts";
import { createChatClient, CredentialsRejectedError, type ChatClientFactory } from "../net/chat.ts";
import { getChatAuth, type Credentials } from "./credentials.ts";
import {
	createProvisioningTransport,
	type ProvisioningTransport,
} from "./provisioningTransport.ts";
import { registerDevice } from "./register.ts";
import { waitForScan } from "./scan.ts";

export { LinkError } from "./linkError.ts";

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
 * `signal-stickers`, and returns its credentials. The caller saves them. Failures the user can act
 * on (an expired code, too many devices, ...) reject with a `LinkError`.
 */
export async function linkDevice({
	env,
	provisioning = createProvisioningTransport(env),
	createChat = createChatClient,
	signal,
	onProgress,
}: LinkOptions): Promise<Credentials> {
	onProgress?.({ step: "connecting" });
	const account = await waitForScan({
		provisioning,
		signal,
		onQrUrl: (qrUrl) => onProgress?.({ step: "waitingForScan", qrUrl }),
	});
	onProgress?.({ step: "registering" });
	const credentials = await registerDevice({ env, account, createChat, signal });
	onProgress?.({ step: "done" });
	return credentials;
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
export async function unlinkDevice({
	credentials,
	createChat = createChatClient,
	signal,
}: UnlinkOptions): Promise<void> {
	const chat = createChat({ env: credentials.env, auth: getChatAuth(credentials) });
	try {
		await chat.requestJson({
			method: "DELETE",
			path: `/v1/devices/${credentials.deviceId}`,
			signal,
		});
	} catch (error) {
		// The chat service rejects the credentials of a device that no longer exists.
		if (!(error instanceof CredentialsRejectedError)) {
			throw error;
		}
	}
}
