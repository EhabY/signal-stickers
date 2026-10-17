import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { readPack, validatePackFolder, type ValidationIssue } from "@signal-stickers/core";
import { PACK_LINK, png, tempDir, writePackFolder } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import {
	blockUntilAborted,
	listenForEvents,
	PACK,
	pull,
	serve,
	servePack,
	startRequest,
	untilReceived,
} from "./support.ts";

const WEBP = Uint8Array.of(...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"));

describe("POST /api/pull", () => {
	it("pulls into the working copy, forwards progress, and reports issues", async () => {
		const issues: ValidationIssue[] = [{ code: "tooLarge", message: "001.png is too large" }];
		const server = await serve({ deps: { validatePackFolder: () => Promise.resolve(issues) } });
		const events = await listenForEvents(server);

		const reply = await pull(server);

		expect(reply).toEqual({
			status: 200,
			body: {
				pack: {
					title: "Cats",
					author: "Ehab",
					cover: "001.png",
					stickers: [
						{ file: "001.png", emoji: "😀" },
						{ file: "002.png", emoji: "😾" },
					],
				},
				issues,
			},
		});
		expect(await readdir(dirname(server.packDir))).toEqual(["pack"]);
		await untilReceived(events, 2);
		expect(events.at(-1)).toEqual({ type: "pull", progress: { done: 2, total: 2 } });
	});

	it("replaces an existing working copy", async () => {
		const server = await servePack();

		await pull(server);

		expect(await readPack(server.packDir)).toMatchObject({ title: "Cats" });
	});

	it.runIf(process.platform !== "win32")(
		"creates the folders above the working copy for the user only",
		async () => {
			const packDir = join(await tempDir(), "config", "pack");
			const server = await serve({ packDir });

			await pull(server);

			expect((await stat(dirname(packDir))).mode & 0o777).toBe(0o700);
		},
	);

	it("refuses to replace a folder that holds no pack", async () => {
		const packDir = await tempDir();
		await writeFile(join(packDir, "notes.txt"), "keep me");
		const server = await serve({ packDir });

		const reply = await pull(server);

		expect(reply).toEqual({
			status: 409,
			body: {
				error: `${packDir} holds files but no pack.json, so importing would delete them. Restart the server with an empty --dir.`,
			},
		});
		expect(await readdir(packDir)).toEqual(["notes.txt"]);
	});

	it("keeps the old working copy when the pull fails", async () => {
		const server = await servePack({ failingStickerId: 1 });

		const reply = await pull(server);

		expect(reply).toEqual({ status: 502, body: { error: "Sticker download failed" } });
		expect(await readPack(server.packDir)).toEqual(PACK);
		const siblings = await readdir(dirname(server.packDir));
		expect(siblings.filter((name) => name.startsWith(basename(server.packDir)))).toEqual([
			basename(server.packDir),
		]);
	});

	it.each([
		["an invalid link", { link: "https://example.com" }, "Not a Signal sticker pack link"],
		["a body without a link", { url: "x" }, "Send the pack link as { link }"],
	])("rejects %s", async (_, body, error) => {
		const server = await serve();

		expect(await server.send("POST", "/api/pull", body)).toEqual({ status: 400, body: { error } });
	});
});

describe("pack editing", () => {
	it("answers 404 before the first pull", async () => {
		const server = await serve();

		expect(await server.get("/api/pack")).toEqual({
			status: 404,
			body: { error: "There is no pack yet: pull one first" },
		});
	});

	it("reports what core's validation finds in the working copy", async () => {
		const server = await servePack({ deps: { validatePackFolder } });

		const reply = await server.get("/api/pack");

		const issues = await validatePackFolder(server.packDir);
		expect(issues).not.toEqual([]);
		expect(reply).toEqual({ status: 200, body: { pack: PACK, issues } });
	});

	it("saves an edited pack.json", async () => {
		const server = await servePack();
		const edited = { ...PACK, title: "Puppies", stickers: PACK.stickers.toReversed() };

		const reply = await server.send("PUT", "/api/pack", edited);

		expect(reply).toEqual({ status: 200, body: { pack: edited, issues: [] } });
		expect(await readPack(server.packDir)).toEqual(edited);
	});

	it.each([
		[
			"names a missing image",
			{ ...PACK, cover: "cover.png" },
			"cover.png is not in the working copy",
		],
		["is malformed", { title: "Dogs" }, "pack.json must be an object with stickers"],
		["escapes the folder", { ...PACK, cover: "../x.png" }, "cover must be a file name in the pack"],
	])("rejects a pack that %s", async (_, pack, error) => {
		const server = await servePack();

		expect(await server.send("PUT", "/api/pack", pack)).toEqual({ status: 400, body: { error } });
		expect(await readPack(server.packDir)).toEqual(PACK);
	});

	it("serves a sticker image uncached", async () => {
		const server = await servePack();

		const response = await fetch(`${server.url}/api/pack/sticker/002.png`);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(2));
	});

	it.each([
		["pack.json", 404],
		["..%2Fpack.json", 404],
		["%E0%A4%A", 400],
	])("serves only images the pack names, not %s", async (file, status) => {
		const server = await servePack();

		expect(await server.get(`/api/pack/sticker/${file}`)).toMatchObject({ status });
	});

	it("adds a sticker under the next free number", async () => {
		const server = await servePack();

		const reply = await server.send("POST", "/api/pack/sticker", WEBP);

		expect(reply).toEqual({
			status: 200,
			body: {
				pack: { ...PACK, stickers: [...PACK.stickers, { file: "003.webp" }] },
				issues: [],
				file: "003.webp",
			},
		});
		expect(new Uint8Array(await readFile(join(server.packDir, "003.webp")))).toEqual(WEBP);
	});

	it.each([
		["a file that is not an image", Uint8Array.of(1, 2, 3), 415],
		["an image over the size limit", new Uint8Array(300 * 1024 + 1), 413],
	])("refuses to add %s", async (_, body, status) => {
		const server = await servePack();

		expect(await server.send("POST", "/api/pack/sticker", body)).toMatchObject({ status });
		expect(await readdir(server.packDir)).toEqual(["001.png", "002.png", "pack.json"]);
	});

	it("removes a sticker and its image, moving the cover to the next sticker", async () => {
		const server = await servePack();

		const reply = await server.send("DELETE", "/api/pack/sticker/001.png");

		const remaining = { ...PACK, cover: "002.png", stickers: PACK.stickers.slice(1) };
		expect(reply).toEqual({ status: 200, body: { pack: remaining, issues: [] } });
		expect(await readdir(server.packDir)).toEqual(["002.png", "pack.json"]);
	});

	it("makes the first remaining sticker the cover when removing the cover sticker", async () => {
		const server = await servePack();
		await server.send("PUT", "/api/pack", { ...PACK, cover: "002.png" });

		const reply = await server.send("DELETE", "/api/pack/sticker/002.png");

		const remaining = { ...PACK, cover: "001.png", stickers: PACK.stickers.slice(0, 1) };
		expect(reply).toEqual({ status: 200, body: { pack: remaining, issues: [] } });
		expect(await readPack(server.packDir)).toEqual(remaining);
		expect(await readdir(server.packDir)).toEqual(["001.png", "pack.json"]);
	});

	it("keeps the image of a removed sticker that is still the cover", async () => {
		const server = await servePack();
		await server.send("DELETE", "/api/pack/sticker/002.png");

		const reply = await server.send("DELETE", "/api/pack/sticker/001.png");

		expect(reply).toMatchObject({ body: { pack: { cover: "001.png", stickers: [] } } });
		expect(await readdir(server.packDir)).toEqual(["001.png", "pack.json"]);
	});

	it("sets a separate cover, replacing the previous one", async () => {
		const server = await servePack();
		await server.send("PUT", "/api/pack/cover", WEBP);

		const reply = await server.send("PUT", "/api/pack/cover", png(3));

		const pack = { ...PACK, cover: "cover.png" };
		expect(reply).toEqual({ status: 200, body: { pack, issues: [] } });
		expect(await readPack(server.packDir)).toEqual(pack);
		expect(await readdir(server.packDir)).toEqual(["001.png", "002.png", "cover.png", "pack.json"]);
		expect(new Uint8Array(await readFile(join(server.packDir, "cover.png")))).toEqual(png(3));
	});

	it.each([
		["a file that is not an image", Uint8Array.of(1, 2, 3), 415],
		["an image over the size limit", new Uint8Array(300 * 1024 + 1), 413],
	])("refuses %s as the cover", async (_, body, status) => {
		const server = await servePack();

		expect(await server.send("PUT", "/api/pack/cover", body)).toMatchObject({ status });
		expect(await readPack(server.packDir)).toEqual(PACK);
	});

	it("refuses to overwrite a sticker named like the cover", async () => {
		const packDir = await writePackFolder(
			{ ...PACK, stickers: [{ file: "cover.png", emoji: "🐶" }] },
			{ "001.png": png(1), "cover.png": png(2) },
		);
		const server = await serve({ packDir });

		expect(await server.send("PUT", "/api/pack/cover", png(3))).toEqual({
			status: 409,
			body: { error: "A sticker uses cover.png, so the cover cannot replace it" },
		});
		expect(new Uint8Array(await readFile(join(packDir, "cover.png")))).toEqual(png(2));
	});

	it("refuses edits while a pull runs", async () => {
		const { started, operation } = blockUntilAborted();
		const server = await servePack({ deps: { pullPack: operation } });
		startRequest(server, "POST", "/api/pull", { link: PACK_LINK });
		await started;

		expect(await server.send("DELETE", "/api/pack/sticker/001.png")).toEqual({
			status: 409,
			body: { error: "Wait for the pull to finish" },
		});
	});
});
