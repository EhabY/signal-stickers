import {
	pushPack as pushThroughCore,
	validatePackFolder as validateThroughCore,
	type PushOptions,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeChat,
	fakeUploadChat,
	memoryCdn,
	NEW_PACK_ID,
	PACK_LOCATOR,
	validPack,
	writePackFolder,
} from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { listenForEvents, PACK, serve, servePack, untilReceived } from "./support.ts";

const NEW_LINK = "https://signal.art/addstickers/#pack_id=new&pack_key=new";

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

	it("uploads a working copy whose stickers have no emoji", async () => {
		const { pack, images } = validPack();
		const stickers = pack.stickers.map(({ file }) => ({ file }));
		const cdn = memoryCdn();
		const server = await serve({
			packDir: await writePackFolder({ ...pack, stickers }, images),
			linked: CREDENTIALS,
			deps: {
				createChat: fakeUploadChat().factory,
				createCdn: () => cdn,
				pushPack: pushThroughCore,
			},
		});

		const reply = await server.send("POST", "/api/push");

		expect(reply.status).toBe(200);
		expect(cdn.uploads).toHaveLength(stickers.length + 1);
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
		expect(issues.map(({ severity }) => severity)).toContain("error");
		expect(reply).toEqual({
			status: 400,
			body: { error: "The pack is not ready to upload", issues },
		});
		expect(cdn.uploads).toEqual([]);
	});

	it("leaves warnings out of the issues that refused a push", async () => {
		const server = await servePack({
			pack: { ...PACK, stickers: [{ file: "001.png" }, { file: "002.png" }] },
			linked: CREDENTIALS,
			deps: { createChat: fakeUploadChat().factory, pushPack: pushThroughCore },
		});

		const reply = await server.send("POST", "/api/push");

		const issues = await validateThroughCore(server.packDir);
		const errors = issues.filter(({ severity }) => severity === "error");
		expect(errors).not.toEqual(issues);
		expect(reply).toEqual({
			status: 400,
			body: { error: "The pack is not ready to upload", issues: errors },
		});
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
