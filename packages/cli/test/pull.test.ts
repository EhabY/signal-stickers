import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { fakeCdn, PACK_LINK } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { USAGE } from "../src/cli.ts";
import { runCli } from "./support.ts";

describe("pull", () => {
	it("pulls a pack into a folder relative to the working directory", async () => {
		const { code, cwd, stdout, stderr, cdnEnvs } = await runCli(["pull", PACK_LINK, "cats"]);

		const dir = join(cwd, "cats");
		expect({ code, cdnEnvs }).toEqual({ code: 0, cdnEnvs: ["production"] });
		expect(stderr).toBe(`Pulling from Signal production into ${dir}\nDownloaded 1/1\n`);
		expect(stdout).toBe(`Pulled "Cats" by Ehab: 1 sticker into ${dir}\n`);
		expect(await readdir(dir)).toEqual(["001.png", "pack.json"]);
	});

	it("fails with usage without a link", async () => {
		const { code, stderr } = await runCli(["pull"]);

		expect(code).toBe(1);
		expect(stderr).toContain(USAGE);
	});

	it("describes untitled packs and counts stickers", async () => {
		const cdn = fakeCdn({ stickers: [{ id: 0 }, { id: 1 }] });

		const { stdout } = await runCli(["pull", PACK_LINK], { cdn });

		expect(stdout).toMatch(/^Pulled an untitled pack: 2 stickers into /u);
	});

	it("reports an invalid link before doing anything", async () => {
		const { code, stderr, cdnEnvs } = await runCli(["pull", "https://example.com"]);

		expect({ code, cdnEnvs }).toEqual({ code: 1, cdnEnvs: [] });
		expect(stderr).toBe("Error: Not a Signal sticker pack link\n");
	});

	it("redraws progress on a terminal and ends the line before an error", async () => {
		const cdn = fakeCdn({ stickers: [{ id: 0 }, { id: 1 }] }, { failingStickerId: 1 });

		const { code, stderr } = await runCli(["pull", PACK_LINK], { cdn, isTTY: true });

		expect(code).toBe(1);
		expect(stderr).toContain("\rDownloaded 1/2\nError: Sticker download failed\n");
	});
});
