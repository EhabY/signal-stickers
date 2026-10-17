import {
	credentialsWarning,
	pushPack as pushThroughCore,
	STICKER_LIMITS,
	validatePackFolder as validateThroughCore,
	type LinkOptions,
	type PushOptions,
	type UnlinkOptions,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeChat,
	fakeUploadChat,
	LINK_RESPONSE,
	linkDeviceByScanning,
	memoryCdn,
	NEW_PACK_ID,
	PACK_LOCATOR,
	validPack,
	writePackFolder,
} from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import {
	blockUntilAborted,
	listenForEvents,
	serve,
	servePack,
	startRequest,
	untilReceived,
} from "./support.ts";

const NEW_LINK = "https://signal.art/addstickers/#pack_id=new&pack_key=new";
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

describe("POST /api/push", () => {
	it("uploads the working copy as the linked device and forwards progress", async () => {
		const chat = fakeChat(() => ({}));
		const calls: PushOptions[] = [];
		const server = await servePack({
			linked: CREDENTIALS,
			deps: {
				createChat: chat.factory,
				pushPack: (options) => {
					calls.push(options);
					options.onProgress?.({ done: 1, total: 3 });
					return Promise.resolve({ locator: PACK_LOCATOR, link: NEW_LINK });
				},
			},
		});
		const events = await listenForEvents(server);

		const reply = await server.send("POST", "/api/push");

		expect(reply).toEqual({ status: 200, body: { link: NEW_LINK } });
		expect(calls).toMatchObject([{ dir: server.packDir, chat }]);
		expect(chat.created).toEqual([
			{
				env: "production",
				auth: { username: `${CREDENTIALS.aci}.2`, password: CREDENTIALS.password },
			},
		]);
		await untilReceived(events, 1);
		expect(events).toEqual([{ type: "push", progress: { done: 1, total: 3 } }]);
	});

	it("validates, encrypts, and uploads the working copy through core", async () => {
		const { pack, images } = validPack();
		const cdn = memoryCdn();
		const server = await serve({
			packDir: await writePackFolder(pack, images),
			linked: CREDENTIALS,
			deps: {
				createChat: fakeUploadChat().factory,
				createCdn: () => cdn,
				pushPack: pushThroughCore,
				validatePackFolder: validateThroughCore,
			},
		});

		const reply = await server.send("POST", "/api/push");

		expect(reply.status).toBe(200);
		expect(reply.body).toHaveProperty("link", expect.stringContaining(`pack_id=${NEW_PACK_ID}`));
		expect(cdn.uploads).toHaveLength(pack.stickers.length + 1);
	});

	it("returns the issues core finds before uploading anything", async () => {
		const cdn = memoryCdn();
		const server = await servePack({
			linked: CREDENTIALS,
			deps: {
				createChat: fakeUploadChat().factory,
				createCdn: () => cdn,
				pushPack: pushThroughCore,
				validatePackFolder: validateThroughCore,
			},
		});

		const reply = await server.send("POST", "/api/push");

		const issues = await validateThroughCore(server.packDir);
		expect(issues).not.toEqual([]);
		expect(reply).toEqual({
			status: 400,
			body: { error: "The pack is not ready to upload", issues },
		});
		expect(cdn.uploads).toEqual([]);
	});

	it("asks to link first", async () => {
		const server = await servePack();

		expect(await server.send("POST", "/api/push")).toEqual({
			status: 400,
			body: { error: "Link a device before uploading" },
		});
	});

	it("refuses a device linked on another environment", async () => {
		const server = await servePack({ env: "staging", linked: CREDENTIALS });

		expect(await server.send("POST", "/api/push")).toEqual({
			status: 400,
			body: { error: "This device is linked on Signal production, but the server uses staging" },
		});
	});

	it("needs a working copy", async () => {
		const server = await serve({ linked: CREDENTIALS });

		expect(await server.send("POST", "/api/push")).toEqual({
			status: 404,
			body: { error: "There is no pack yet: pull one first" },
		});
	});
});
