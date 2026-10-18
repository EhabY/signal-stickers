import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { readPack, type ValidationIssue } from "@signal-stickers/core";
import { tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { listenForEvents, PACK, pull, serve, servePack, untilReceived } from "./support.ts";

describe("POST /api/pull", () => {
	it("pulls into the working copy, forwards progress, and reports issues", async () => {
		const issues: ValidationIssue[] = [
			{ code: "tooLarge", severity: "error", message: "001.png is too large" },
		];
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
