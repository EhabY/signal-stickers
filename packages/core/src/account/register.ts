import type { Environment } from "../env.ts";
import type { ChatClientFactory } from "../net/chat.ts";
import { HttpError } from "../net/http.ts";
import { isRecord } from "../util/isRecord.ts";
import type { Credentials } from "./credentials.ts";
import { encryptDeviceName } from "./deviceName.ts";
import {
	generatePassword,
	generatePreKeys,
	generateRegistrationId,
	type SerializedPreKey,
} from "./keys.ts";
import { LinkError } from "./linkError.ts";
import type { ProvisionedAccount } from "./provisioningCipher.ts";

export type RegisterOptions = Readonly<{
	env: Environment;
	account: ProvisionedAccount;
	createChat: ChatClientFactory;
	signal?: AbortSignal | undefined;
}>;

/** `PUT /v1/devices/link`; JSON drops the PNI fields when they are undefined. */
export type LinkRequest = Readonly<{
	verificationCode: string;
	accountAttributes: Readonly<{
		fetchesMessages: boolean;
		/** Base64 `DeviceName`. */
		name: string;
		registrationId: number;
		pniRegistrationId: number | undefined;
		capabilities: Readonly<Record<string, boolean>>;
	}>;
	aciSignedPreKey: SerializedPreKey;
	aciPqLastResortPreKey: SerializedPreKey;
	pniSignedPreKey: SerializedPreKey | undefined;
	pniPqLastResortPreKey: SerializedPreKey | undefined;
}>;

export const DEVICE_NAME = "signal-stickers";

// Statuses Signal Desktop explains when linking fails (`finishInstall`, `translateError`).
const RATE_LIMITED = "Signal is limiting link attempts. Wait a while and try again.";
const LINK_FAILURES = new Map([
	[403, "The phone's linking code was rejected or has expired. Scan a new QR code."],
	[409, "Signal no longer accepts this version of signal-stickers. Update it and try again."],
	[
		422,
		"Signal rejected the link request's contents, so its format probably changed. Update " +
			"signal-stickers, or see docs/SIGNAL_COMPAT.md.",
	],
	[
		411,
		"Your account already has the most linked devices allowed. Remove one in Signal on your " +
			"phone (Settings > Linked devices) and try again.",
	],
	[413, RATE_LIMITED],
	[429, RATE_LIMITED],
]);

/**
 * Registers the scanned account's new device with `PUT /v1/devices/link`, like Signal Desktop's
 * `linkDevice`, and returns its credentials.
 */
export async function registerDevice({
	env,
	account,
	createChat,
	signal,
}: RegisterOptions): Promise<Credentials> {
	const password = generatePassword();
	const chat = createChat({ env, auth: { username: account.aci, password } });
	const response = await chat
		.requestJson({
			method: "PUT",
			path: "/v1/devices/link",
			body: await buildLinkRequest(account),
			signal,
		})
		.catch(explainLinkFailure);
	const { aci, pni, deviceId } = parseLinkResponse(response);
	assertLinkedAccount(account, { aci, pni });
	return {
		env,
		aci,
		pni,
		number: account.phoneNumber?.number,
		deviceId,
		password,
		createdAt: new Date().toISOString(),
	};
}

/** The body of Signal Desktop's `linkDevice`, field for field and in the same order. */
export async function buildLinkRequest({
	aciIdentityKey,
	provisioningCode,
	phoneNumber,
}: ProvisionedAccount): Promise<LinkRequest> {
	const aciKeys = await generatePreKeys(aciIdentityKey);
	const pniKeys = phoneNumber && (await generatePreKeys(phoneNumber.pniIdentityKey));
	return {
		verificationCode: provisioningCode,
		accountAttributes: {
			// Required: Signal accepts only devices that fetch messages or have a push token.
			fetchesMessages: true,
			name: await encryptDeviceName(DEVICE_NAME, aciIdentityKey.getPublicKey()),
			registrationId: generateRegistrationId(),
			pniRegistrationId: phoneNumber ? generateRegistrationId() : undefined,
			// Signal Desktop's `getCapabilities`; the service refuses links missing required ones (409).
			capabilities: {
				attachmentBackfill: true,
				spqr: true,
				usernameChangeSyncMessage: true,
				optionalPhoneNumber: !phoneNumber,
			},
		},
		aciSignedPreKey: aciKeys.signedPreKey,
		aciPqLastResortPreKey: aciKeys.pqLastResortPreKey,
		pniSignedPreKey: pniKeys?.signedPreKey,
		pniPqLastResortPreKey: pniKeys?.pqLastResortPreKey,
	};
}

function explainLinkFailure(error: unknown): never {
	const message = error instanceof HttpError ? LINK_FAILURES.get(error.status ?? 0) : undefined;
	throw message === undefined ? error : new LinkError(message, { cause: error });
}

function parseLinkResponse(value: unknown): {
	aci: string;
	pni: string | undefined;
	deviceId: number;
} {
	if (
		!isRecord(value) ||
		typeof value.uuid !== "string" ||
		typeof value.deviceId !== "number" ||
		!Number.isInteger(value.deviceId) ||
		!(value.pni === undefined || value.pni === null || typeof value.pni === "string")
	) {
		throw new LinkError("Signal sent an unexpected reply to the link request. Try again.");
	}
	return { aci: value.uuid.toLowerCase(), pni: value.pni?.toLowerCase(), deviceId: value.deviceId };
}

/**
 * Like Signal Desktop's `createAccount`: a PNI in the reply must be the one the phone sent, and its
 * ACI the phone's. Signal has already added the device, so the user removes it before linking again.
 */
function assertLinkedAccount(
	account: ProvisionedAccount,
	{ aci, pni }: { aci: string; pni: string | undefined },
): void {
	const removeDevice =
		'Remove "signal-stickers" from Linked devices on your phone, then link again.';
	if (pni !== undefined && pni !== account.phoneNumber?.pni) {
		throw new LinkError(
			`Signal linked this device to a different phone number identity (PNI) than your phone sent. ${removeDevice}`,
		);
	}
	if (aci !== account.aci) {
		throw new LinkError(
			`Signal linked this device to a different account (ACI) than your phone sent. ${removeDevice}`,
		);
	}
}
