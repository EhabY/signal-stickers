import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { readPack, validatePackFolder } from "@signal-stickers/core";
import { PACK_LINK, png, writePackFolder } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { blockUntilAborted, PACK, serve, servePack, startRequest } from "./support.ts";

const WEBP = Uint8Array.of(...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"));

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

	it("reports a sticker without an emoji as a warning, apart from errors", async () => {
		const stickers = [PACK.stickers[0]!, { file: "002.png" }];
		const server = await servePack({ pack: { ...PACK, stickers }, deps: { validatePackFolder } });

		const reply = await server.get("/api/pack");

		expect(reply.body).toMatchObject({
			issues: [
				{ code: "missingEmoji", severity: "warning", file: "002.png" },
				{ code: "unsupportedFormat", severity: "error", file: "001.png" },
				{ code: "unsupportedFormat", severity: "error", file: "002.png" },
			],
		});
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

		const reply = await server.send("DELETE", "/api/pack/sticker/0/001.png");

		const remaining = { ...PACK, cover: "002.png", stickers: PACK.stickers.slice(1) };
		expect(reply).toEqual({ status: 200, body: { pack: remaining, issues: [] } });
		expect(await readdir(server.packDir)).toEqual(["002.png", "pack.json"]);
	});

	it("makes the first remaining sticker the cover when removing the cover sticker", async () => {
		const server = await servePack();
		await server.send("PUT", "/api/pack", { ...PACK, cover: "002.png" });

		const reply = await server.send("DELETE", "/api/pack/sticker/1/002.png");

		const remaining = { ...PACK, cover: "001.png", stickers: PACK.stickers.slice(0, 1) };
		expect(reply).toEqual({ status: 200, body: { pack: remaining, issues: [] } });
		expect(await readPack(server.packDir)).toEqual(remaining);
		expect(await readdir(server.packDir)).toEqual(["001.png", "pack.json"]);
	});

	it("keeps the image of a removed sticker that is still the cover", async () => {
		const server = await servePack();
		await server.send("DELETE", "/api/pack/sticker/1/002.png");

		const reply = await server.send("DELETE", "/api/pack/sticker/0/001.png");

		expect(reply).toMatchObject({ body: { pack: { cover: "001.png", stickers: [] } } });
		expect(await readdir(server.packDir)).toEqual(["001.png", "pack.json"]);
	});

	it("removes the sticker at its position when stickers share an image", async () => {
		const stickers = [{ file: "002.png" }, { file: "001.png", emoji: "😀" }, PACK.stickers[0]!];
		const server = await servePack({ pack: { ...PACK, stickers } });

		const reply = await server.send("DELETE", "/api/pack/sticker/2/001.png");

		expect(reply).toMatchObject({ body: { pack: { ...PACK, stickers: stickers.slice(0, 2) } } });
		expect(await readdir(server.packDir)).toEqual(["001.png", "002.png", "pack.json"]);
	});

	it.each([
		["/api/pack/sticker/1/001.png", 404],
		["/api/pack/sticker/first/001.png", 400],
	])("refuses DELETE %s, which names no sticker", async (path, status) => {
		const server = await servePack();

		expect(await server.send("DELETE", path)).toMatchObject({ status });
		expect(await readPack(server.packDir)).toEqual(PACK);
	});

	it("replaces a sticker's image under a new name, keeping its place, emoji, and cover", async () => {
		const server = await servePack();

		const reply = await server.send("PUT", "/api/pack/sticker/0/001.png", WEBP);

		const [first, second] = PACK.stickers;
		const pack = { ...PACK, cover: "003.webp", stickers: [{ ...first, file: "003.webp" }, second] };
		expect(reply).toEqual({ status: 200, body: { pack, issues: [] } });
		expect(await readPack(server.packDir)).toEqual(pack);
		expect(await readdir(server.packDir)).toEqual(["002.png", "003.webp", "pack.json"]);
		expect(new Uint8Array(await readFile(join(server.packDir, "003.webp")))).toEqual(WEBP);
	});

	it("keeps a replaced image that another sticker still uses", async () => {
		const stickers = [PACK.stickers[0]!, { file: "001.png", emoji: "😀" }];
		const server = await servePack({ pack: { ...PACK, cover: "002.png", stickers } });

		const reply = await server.send("PUT", "/api/pack/sticker/1/001.png", png(3));

		expect(reply).toMatchObject({
			body: {
				pack: { cover: "002.png", stickers: [stickers[0], { file: "003.png", emoji: "😀" }] },
			},
		});
		expect(await readdir(server.packDir)).toEqual(["001.png", "002.png", "003.png", "pack.json"]);
	});

	it.each([
		["a stale position", "/api/pack/sticker/1/001.png", WEBP, 404],
		["a position that is not a number", "/api/pack/sticker/first/001.png", WEBP, 400],
		["a file that is not an image", "/api/pack/sticker/0/001.png", Uint8Array.of(1, 2, 3), 415],
		[
			"an image over the size limit",
			"/api/pack/sticker/0/001.png",
			new Uint8Array(300 * 1024 + 1),
			413,
		],
	])("refuses to replace a sticker's image given %s", async (_, path, body, status) => {
		const server = await servePack();

		expect(await server.send("PUT", path, body)).toMatchObject({ status });
		expect(await readPack(server.packDir)).toEqual(PACK);
		expect(await readdir(server.packDir)).toEqual(["001.png", "002.png", "pack.json"]);
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

		expect(await server.send("DELETE", "/api/pack/sticker/0/001.png")).toEqual({
			status: 409,
			body: { error: "Wait for the pull to finish" },
		});
		expect(await server.send("PUT", "/api/pack/sticker/0/001.png", WEBP)).toMatchObject({
			status: 409,
		});
	});
});
