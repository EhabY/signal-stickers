import { join } from "node:path";

import {
	PackValidationError,
	parsePackLink,
	pushPack as pushThroughCore,
	type ValidationIssue,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeUploadChat,
	imageFixture,
	memoryCdn,
	memoryCredentialsStore,
	NEW_PACK_ID,
	PACK_LINK,
	validPack,
	writePackFolder,
} from "@signal-stickers/core/testing";
import { toString as renderQr } from "qrcode";
import { describe, expect, it } from "vitest";

import { USAGE } from "../src/cli.ts";
import { fakePushPack, runCli, unusedChat } from "./support.ts";

describe("push", () => {
	it("uploads the pack folder as the linked device and prints the new link", async () => {
		const chat = unusedChat();
		const pushPack = fakePushPack();

		const { code, cwd, signal, stdout, stderr, cdnEnvs } = await runCli(["push", "cats"], {
			chat,
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack,
		});

		const dir = join(cwd, "cats");
		expect(code).toBe(0);
		expect(stderr).toBe(`Pushing ${dir} to Signal production\nUploaded 1/2\nUploaded 2/2\n`);
		expect(stdout).toBe(`${PACK_LINK}\n`);
		expect(pushPack).toHaveBeenCalledWith(expect.objectContaining({ dir, chat, signal }));
		expect(chat.created).toEqual([
			{
				env: "production",
				auth: { username: `${CREDENTIALS.aci}.2`, password: CREDENTIALS.password },
			},
		]);
		expect(cdnEnvs).toEqual(["production"]);
	});

	it("validates, encrypts, and uploads the pack through core", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder(pack, images);
		const cdn = memoryCdn();

		const { code, stdout } = await runCli(["push", dir], {
			chat: fakeUploadChat(),
			cdn,
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack: pushThroughCore,
		});

		expect(code).toBe(0);
		expect(parsePackLink(stdout.trim()).packId).toBe(NEW_PACK_ID);
		expect(cdn.uploads).toHaveLength(pack.stickers.length + 1);
	});

	it("lists the problems core finds before uploading anything", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder({ ...pack, title: "" }, images);
		const cdn = memoryCdn();

		const { code, stderr } = await runCli(["push", dir], {
			chat: fakeUploadChat(),
			cdn,
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack: pushThroughCore,
		});

		expect(code).toBe(1);
		expect(stderr).toMatch(/\nError: The pack is not ready to push:\n {2}- .*title/u);
		expect(cdn.uploads).toEqual([]);
	});

	it("tells how to convert an animated WebP, which Signal cannot animate", async () => {
		const { pack } = validPack(1);
		const dir = await writePackFolder(
			{ ...pack, stickers: [{ file: "001.webp", emoji: "😀" }], cover: "001.webp" },
			{ "001.webp": imageFixture("animated.webp") },
		);

		const { code, stderr } = await runCli(["push", dir], {
			chat: fakeUploadChat(),
			cdn: memoryCdn(),
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack: pushThroughCore,
		});

		expect(code).toBe(1);
		expect(stderr).toContain(
			"\n  - 001.webp is an animated WebP, but Signal only animates PNG stickers; remove it and add the original file in the web editor, which converts it to an animated PNG\n",
		);
	});

	it("pushes ./pack by default", async () => {
		const pushPack = fakePushPack();

		const { cwd } = await runCli(["push"], {
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack,
		});

		expect(pushPack).toHaveBeenCalledWith(expect.objectContaining({ dir: join(cwd, "pack") }));
	});

	it("redraws progress and shows the link as a QR code on a terminal", async () => {
		const { stdout, stderr } = await runCli(["push"], {
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack: fakePushPack(),
			isTTY: true,
		});

		const qr = await renderQr(PACK_LINK, { type: "terminal", small: true });
		expect(stderr).toMatch(/\rUploaded 1\/2\rUploaded 2\/2\n$/u);
		expect(stdout).toBe(`${PACK_LINK}\n${qr}\n`);
	});

	it("lists every validation issue", async () => {
		const issues: ValidationIssue[] = [
			{ code: "missingTitle", message: "The pack needs a title" },
			{ code: "wrongSize", message: "001.png is 100x100 pixels, not 512x512", file: "001.png" },
		];

		const { code, stderr } = await runCli(["push"], {
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			pushPack: fakePushPack(new PackValidationError(issues)),
		});

		expect(code).toBe(1);
		expect(stderr).toMatch(
			/\nError: The pack is not ready to push:\n {2}- The pack needs a title\n {2}- 001\.png is 100x100 pixels, not 512x512\n$/u,
		);
	});

	it("asks to link first when not linked", async () => {
		const pushPack = fakePushPack();

		const { code, stderr } = await runCli(["push"], { pushPack });

		expect(code).toBe(1);
		expect(stderr).toBe('Error: Not linked. Run "signal-stickers link" first.\n');
		expect(pushPack).not.toHaveBeenCalled();
	});

	it("refuses credentials from another environment", async () => {
		const pushPack = fakePushPack();

		const { code, stderr } = await runCli(["push"], {
			credentialsStore: memoryCredentialsStore({ ...CREDENTIALS, env: "staging" }),
			pushPack,
		});

		expect(code).toBe(1);
		expect(stderr).toBe(
			"Error: Linked to Signal staging, not production. Add --staging to use it.\n",
		);
		expect(pushPack).not.toHaveBeenCalled();
	});

	it("fails with usage for more than one folder", async () => {
		const { code, stderr } = await runCli(["push", "a", "b"]);

		expect(code).toBe(1);
		expect(stderr).toContain(USAGE);
	});
});
