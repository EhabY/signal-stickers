import type { Environment } from "@signal-stickers/core";
import {
	fakeCdn,
	tempDir,
	type FakeCdn,
	type StickerPackProto,
} from "@signal-stickers/core/testing";

import { run } from "../src/cli.ts";

export const CATS: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	stickers: [{ id: 0, emoji: "😀" }],
};

export type CliOptions = {
	env?: Record<string, string>;
	/** Makes both stdout and stderr terminals. */
	isTTY?: boolean;
	cdn?: FakeCdn;
};

/** Runs the CLI in a fresh working directory with captured output and fakes for every service. */
export async function runCli(
	args: string[],
	{ env = {}, isTTY = false, cdn = fakeCdn(CATS) }: CliOptions = {},
) {
	const cwd = await tempDir();
	const stdout = capture(isTTY);
	const stderr = capture(isTTY);
	const cdnEnvs: Environment[] = [];
	const code = await run(args, {
		stdout,
		stderr,
		env,
		cwd,
		createCdn: (selected) => {
			cdnEnvs.push(selected);
			return cdn;
		},
	});
	return { code, cwd, stdout: stdout.text, stderr: stderr.text, cdnEnvs };
}

function capture(isTTY: boolean) {
	const output = { text: "", isTTY, write: (text: string) => (output.text += text) };
	return output;
}
