import {
	credentialsWarning,
	STICKER_LIMITS,
	type LinkOptions,
	type UnlinkOptions,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeChat,
	LINK_RESPONSE,
	linkDeviceByScanning,
	memoryCredentialsStore,
} from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import {
	blockUntilAborted,
	listenForEvents,
	serve,
	startRequest,
	untilReceived,
} from "./support.ts";

const QR_URL = "sgnl://linkdevice?uuid=address&pub_key=key";

describe("GET /api/status", () => {
	it("reports the environment, an unlinked device, and the sticker limits", async () => {
		const server = await serve({ env: "staging" });

		expect(await server.get("/api/status")).toEqual({
			status: 200,
			body: { env: "staging", link: { linked: false }, limits: STICKER_LIMITS },
		});
	});

	it("describes the linked device without its password", async () => {
		const server = await serve({ linked: CREDENTIALS });

		const { body } = await server.get("/api/status");

		expect(body).toMatchObject({ link: { linked: true, aci: CREDENTIALS.aci, deviceId: 2 } });
		expect(JSON.stringify(body)).not.toContain(CREDENTIALS.password);
	});
});

describe("POST /api/link", () => {
	it("links for the server's environment, forwards progress, and saves the credentials", async () => {
		const calls: LinkOptions[] = [];
		const server = await serve({
			env: "staging",
			deps: {
				linkDevice: (options) => {
					calls.push(options);
					options.onProgress?.({ step: "waitingForScan", qrUrl: QR_URL });
					return Promise.resolve(CREDENTIALS);
				},
			},
		});
		const events = await listenForEvents(server);

		const reply = await server.send("POST", "/api/link");

		expect(reply).toMatchObject({ status: 200, body: { link: { linked: true } } });
		expect(calls).toMatchObject([{ env: "staging" }]);
		expect(server.credentials.current()).toEqual(CREDENTIALS);
		expect(server.logs).toEqual([`Linked. ${credentialsWarning(server.credentials.path)}`]);
		await untilReceived(events, 1);
		expect(events).toEqual([{ type: "link", progress: { step: "waitingForScan", qrUrl: QR_URL } }]);
	});

	it("links through core when the phone scans the QR code", async () => {
		const server = await serve({
			deps: {
				linkDevice: linkDeviceByScanning(),
				createChat: fakeChat(() => LINK_RESPONSE).factory,
			},
		});

		const reply = await server.send("POST", "/api/link");

		expect(reply).toMatchObject({
			status: 200,
			body: { link: { linked: true, deviceId: LINK_RESPONSE.deviceId } },
		});
		expect(server.credentials.current()).toMatchObject({ aci: LINK_RESPONSE.uuid });
	});

	it("explains how to recover when the credentials cannot be saved", async () => {
		const credentials = {
			...memoryCredentialsStore(),
			save: () => Promise.reject(new Error("Disk full")),
		};
		const server = await serve({
			deps: { credentials, linkDevice: () => Promise.resolve(CREDENTIALS) },
		});

		const reply = await server.send("POST", "/api/link");

		expect(reply).toEqual({
			status: 500,
			body: {
				error: `Linked, but could not save the credentials to ${credentials.path} (Disk full). Remove "signal-stickers" from Linked devices on your phone, then link again.`,
			},
		});
	});

	it("refuses to link twice", async () => {
		const server = await serve({ linked: CREDENTIALS });

		expect(await server.send("POST", "/api/link")).toEqual({
			status: 400,
			body: { error: "Already linked: unlink first" },
		});
	});

	it("answers 409 while another operation runs", async () => {
		const { started, operation } = blockUntilAborted();
		const server = await serve({ deps: { linkDevice: operation } });
		startRequest(server, "POST", "/api/link");
		await started;

		expect(await server.send("POST", "/api/unlink")).toEqual({
			status: 409,
			body: { error: "Wait for the link to finish" },
		});
	});
});

describe("POST /api/unlink", () => {
	it("removes the device and deletes its credentials", async () => {
		const calls: UnlinkOptions[] = [];
		const server = await serve({
			linked: CREDENTIALS,
			deps: {
				unlinkDevice: (options) => {
					calls.push(options);
					return Promise.resolve();
				},
			},
		});

		const reply = await server.send("POST", "/api/unlink");

		expect(reply).toMatchObject({ status: 200, body: { link: { linked: false } } });
		expect(calls).toMatchObject([{ credentials: CREDENTIALS }]);
		expect(server.credentials.current()).toBeUndefined();
	});

	it("does nothing when not linked", async () => {
		const server = await serve({
			deps: { unlinkDevice: () => Promise.reject(new Error("unused")) },
		});

		expect(await server.send("POST", "/api/unlink")).toMatchObject({ status: 200 });
	});
});
