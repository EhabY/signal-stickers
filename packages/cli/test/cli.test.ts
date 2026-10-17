import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Environment } from "@signal-stickers/core";
import {
	fakeCdn,
	PACK_LINK,
	tempDir,
	type FakeCdnOptions,
	type StickerPackProto,
} from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { run, USAGE } from "../src/cli.ts";

const CATS: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	stickers: [{ id: 0, emoji: "😀" }],
};

type CliOptions = FakeCdnOptions & {
	env?: Record<string, string>;
	manifest?: StickerPackProto;
	isTTY?: boolean;
};

function capture(isTTY = false) {
	const output = { text: "", isTTY, write: (text: string) => (output.text += text) };
	return output;
}

async function cli(
	args: string[],
	{ env = {}, manifest = CATS, isTTY, ...cdnOptions }: CliOptions = {},
) {
	const cwd = await tempDir();
	const stdout = capture();
	const stderr = capture(isTTY);
	const envs: Environment[] = [];
	const code = await run(args, {
		stdout,
		stderr,
		env,
		cwd,
		createCdn: (selected) => {
			envs.push(selected);
			return fakeCdn(manifest, cdnOptions);
		},
	});
	return { code, cwd, stdout: stdout.text, stderr: stderr.text, envs };
}

describe("cli", () => {
	it("prints usage with --help", async () => {
		expect(await cli(["--help"])).toMatchObject({ code: 0, stdout: USAGE });
	});

	it.each([
		["no command", []],
		["an unknown command", ["frobnicate"]],
		["an unknown option", ["pull", "--nope"]],
		["pull without a link", ["pull"]],
	])("fails with usage for %s", async (_, args) => {
		const { code, stderr } = await cli(args);

		expect(code).toBe(1);
		expect(stderr).toContain(USAGE);
	});

	it("pulls a pack into a folder relative to the working directory", async () => {
		const { code, cwd, stdout, stderr, envs } = await cli(["pull", PACK_LINK, "cats"]);

		const dir = join(cwd, "cats");
		expect({ code, envs }).toEqual({ code: 0, envs: ["production"] });
		expect(stderr).toBe(`Pulling from Signal production into ${dir}\nDownloaded 1/1\n`);
		expect(stdout).toBe(`Pulled "Cats" by Ehab: 1 sticker into ${dir}\n`);
		expect(await readdir(dir)).toEqual(["001.png", "pack.json"]);
	});

	it("describes untitled packs and counts stickers", async () => {
		const manifest = { stickers: [{ id: 0 }, { id: 1 }] };

		const { stdout } = await cli(["pull", PACK_LINK], { manifest });

		expect(stdout).toMatch(/^Pulled an untitled pack: 2 stickers into /u);
	});

	it.each([
		["--staging", ["--staging"], {}],
		["SIGNAL_STICKERS_ENV", [], { SIGNAL_STICKERS_ENV: "staging" }],
	])("selects staging with %s", async (_, flags, env) => {
		const { envs } = await cli(["pull", PACK_LINK, ...flags], { env });

		expect(envs).toEqual(["staging"]);
	});

	it("rejects an unknown SIGNAL_STICKERS_ENV", async () => {
		const result = await cli(["pull", PACK_LINK], { env: { SIGNAL_STICKERS_ENV: "dev" } });

		expect(result).toMatchObject({ code: 1, envs: [] });
	});

	it("reports an invalid link before doing anything", async () => {
		const { code, stderr, envs } = await cli(["pull", "https://example.com"]);

		expect({ code, envs }).toEqual({ code: 1, envs: [] });
		expect(stderr).toBe("Error: Not a Signal sticker pack link\n");
	});

	it("redraws progress on a terminal and ends the line before an error", async () => {
		const manifest = { stickers: [{ id: 0 }, { id: 1 }] };

		const { code, stderr } = await cli(["pull", PACK_LINK], {
			manifest,
			isTTY: true,
			failingStickerId: 1,
		});

		expect(code).toBe(1);
		expect(stderr).toContain("\rDownloaded 1/2\nError: Sticker download failed\n");
	});
});
