import { describe, expect, it } from "vitest";

import {
	getLinkStatus,
	LinkError,
	linkDevice,
	unlinkDevice,
	type LinkProgress,
} from "../../src/account/link.ts";
import { CredentialsRejectedError, type ChatRequest } from "../../src/net/chat.ts";
import { HttpError } from "../../src/net/http.ts";
import type { ProvisionMessageProto } from "../../src/protocol/provisioning.ts";
import {
	CREDENTIALS,
	fakeChat,
	fakeProvisioning,
	LINK_RESPONSE,
	LINKED_ACCOUNT,
	linkDeviceByScanning,
	PROVISION_MESSAGE_WITHOUT_NUMBER,
} from "../support/index.ts";

type LinkSetup = Readonly<{
	message?: ProvisionMessageProto | undefined;
	respond?: (request: ChatRequest) => unknown;
}>;

/** Links on staging with a phone that scans the first QR code. */
function link({ message, respond = () => LINK_RESPONSE }: LinkSetup = {}) {
	const provisioning = fakeProvisioning({ message });
	const chat = fakeChat(respond);
	const progress: LinkProgress[] = [];
	const linking = linkDeviceByScanning(provisioning)({
		env: "staging",
		createChat: chat.factory,
		onProgress: (event) => {
			progress.push(event);
		},
	});
	return { linking, chat, progress, provisioning };
}

const failWith = (status: number) => () => {
	throw new HttpError(`PUT /v1/devices/link failed with status ${status}`, { status });
};

describe("linkDevice", () => {
	it("returns the new device's credentials for the scanned account", async () => {
		const { linking } = link();

		const { password, createdAt, ...credentials } = await linking;

		expect(credentials).toEqual({
			env: "staging",
			aci: LINKED_ACCOUNT.aci,
			pni: LINKED_ACCOUNT.pni,
			number: LINKED_ACCOUNT.number,
			deviceId: 3,
		});
		expect(password).toMatch(/^[A-Za-z0-9+/]{22}$/u);
		expect(Date.parse(createdAt)).not.toBeNaN();
	});

	it("reports each step in order", async () => {
		const { linking, progress } = link();

		await linking;

		expect(progress.map(({ step }) => step)).toEqual([
			"connecting",
			"waitingForScan",
			"registering",
			"done",
		]);
	});

	it("registers with the aci and the new password on the chosen environment", async () => {
		const { linking, chat } = link();

		const { password } = await linking;

		expect(chat.created).toEqual([
			{ env: "staging", auth: { username: LINKED_ACCOUNT.aci, password } },
		]);
	});

	it("sends the link request for the scanned account", async () => {
		const { linking, chat } = link();

		await linking;

		expect(chat.requests).toMatchObject([
			{
				method: "PUT",
				path: "/v1/devices/link",
				body: {
					verificationCode: LINKED_ACCOUNT.provisioningCode,
					accountAttributes: { capabilities: { optionalPhoneNumber: false } },
				},
			},
		]);
	});

	it("links without a phone number when the phone shares none", async () => {
		const { linking, chat } = link({
			message: PROVISION_MESSAGE_WITHOUT_NUMBER,
			respond: () => ({ uuid: LINKED_ACCOUNT.aci, deviceId: 3 }),
		});

		const credentials = await linking;

		expect(credentials).toMatchObject({ pni: undefined, number: undefined });
		expect(chat.requests).toMatchObject([
			{ body: { accountAttributes: { capabilities: { optionalPhoneNumber: true } } } },
		]);
	});

	it.each([
		[403, "linking code was rejected"],
		[409, "Update it"],
		[411, "Remove one in Signal on your phone"],
		[422, "see docs/SIGNAL_COMPAT.md"],
		[413, "limiting link attempts"],
		[429, "limiting link attempts"],
	])("explains a %i from the link request", async (status, message) => {
		const { linking } = link({ respond: failWith(status) });

		await expect(linking).rejects.toThrow(LinkError);
		await expect(linking).rejects.toThrow(message);
	});

	it("passes other failures through", async () => {
		const { linking } = link({ respond: failWith(500) });

		await expect(linking).rejects.toThrow(HttpError);
	});

	it.each([
		["another PNI", undefined, { ...LINK_RESPONSE, pni: "11111111-2222-4333-8444-555555555555" }],
		["a PNI the phone did not send", PROVISION_MESSAGE_WITHOUT_NUMBER, LINK_RESPONSE],
	])("rejects a reply with %s, like Signal Desktop", async (_, message, reply) => {
		const { linking } = link({ message, respond: () => reply });

		await expect(linking).rejects.toThrow(LinkError);
		await expect(linking).rejects.toThrow(
			'different phone number identity (PNI) than your phone sent. Remove "signal-stickers"',
		);
	});

	it("rejects a reply with another ACI, like Signal Desktop", async () => {
		const reply = { ...LINK_RESPONSE, uuid: "11111111-2222-4333-8444-555555555555" };
		const { linking } = link({ respond: () => reply });

		await expect(linking).rejects.toThrow("different account (ACI) than your phone sent");
	});

	it("accepts the phone's PNI in upper case", async () => {
		const { linking } = link({
			respond: () => ({ ...LINK_RESPONSE, pni: LINKED_ACCOUNT.pni.toUpperCase() }),
		});

		await expect(linking).resolves.toMatchObject({ pni: LINKED_ACCOUNT.pni });
	});

	it("rejects an unexpected reply", async () => {
		const { linking } = link({ respond: () => ({ uuid: LINKED_ACCOUNT.aci }) });

		await expect(linking).rejects.toThrow("unexpected reply");
	});

	it("stops without registering when aborted", async () => {
		const controller = new AbortController();
		const chat = fakeChat(() => LINK_RESPONSE);

		const linking = linkDevice({
			env: "production",
			provisioning: fakeProvisioning().transport,
			createChat: chat.factory,
			signal: controller.signal,
			onProgress: () => {
				controller.abort(new Error("cancelled"));
			},
		});

		await expect(linking).rejects.toThrow("cancelled");
		expect(chat.requests).toEqual([]);
	});
});

describe("getLinkStatus", () => {
	it("describes linked credentials without the password", () => {
		const status = getLinkStatus({ ...CREDENTIALS, number: LINKED_ACCOUNT.number });

		expect(status).toEqual({
			linked: true,
			env: "production",
			aci: CREDENTIALS.aci,
			deviceId: 2,
			number: LINKED_ACCOUNT.number,
			createdAt: CREDENTIALS.createdAt,
		});
	});

	it("reports no credentials as unlinked", () => {
		expect(getLinkStatus()).toEqual({ linked: false });
	});
});

describe("unlinkDevice", () => {
	it("deletes this device as itself", async () => {
		const chat = fakeChat(() => ({}));

		await unlinkDevice({ credentials: CREDENTIALS, createChat: chat.factory });

		expect(chat.created).toEqual([
			{
				env: "production",
				auth: { username: `${CREDENTIALS.aci}.2`, password: CREDENTIALS.password },
			},
		]);
		expect(chat.requests).toEqual([{ method: "DELETE", path: "/v1/devices/2", signal: undefined }]);
	});

	it("treats rejected credentials as already unlinked", async () => {
		const chat = fakeChat(() => {
			throw new CredentialsRejectedError("DELETE failed", { status: 401 });
		});

		await expect(
			unlinkDevice({ credentials: CREDENTIALS, createChat: chat.factory }),
		).resolves.toBeUndefined();
	});

	it("passes other failures through", async () => {
		const chat = fakeChat(() => {
			throw new HttpError("DELETE failed", { status: 500 });
		});

		await expect(
			unlinkDevice({ credentials: CREDENTIALS, createChat: chat.factory }),
		).rejects.toThrow(HttpError);
	});
});
