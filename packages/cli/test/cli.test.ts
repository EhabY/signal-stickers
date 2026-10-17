import { PACK_LINK } from "@signal-stickers/core/testing";
import { describe, expect, it } from "vitest";

import { USAGE } from "../src/cli.ts";
import { runCli } from "./support.ts";

describe("cli", () => {
	it("prints usage with --help", async () => {
		expect(await runCli(["--help"])).toMatchObject({ code: 0, stdout: USAGE });
	});

	it.each([
		["no command", []],
		["an unknown command", ["frobnicate"]],
		["an unknown option", ["pull", "--nope"]],
	])("fails with usage for %s", async (_, args) => {
		const { code, stderr } = await runCli(args);

		expect(code).toBe(1);
		expect(stderr).toContain(USAGE);
	});

	it.each([
		["--staging", ["--staging"], {}],
		["SIGNAL_STICKERS_ENV", [], { SIGNAL_STICKERS_ENV: "staging" }],
	])("selects staging with %s", async (_, flags, env) => {
		const { cdnEnvs } = await runCli(["pull", PACK_LINK, ...flags], { env });

		expect(cdnEnvs).toEqual(["staging"]);
	});

	it("rejects an unknown SIGNAL_STICKERS_ENV", async () => {
		const result = await runCli(["pull", PACK_LINK], { env: { SIGNAL_STICKERS_ENV: "dev" } });

		expect(result).toMatchObject({ code: 1, cdnEnvs: [] });
	});
});
