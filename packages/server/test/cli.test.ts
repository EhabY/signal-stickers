import { join } from "node:path";

import { memoryCredentialsStore, tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it, vi } from "vitest";

import { run, USAGE } from "../src/cli.ts";

type CliOptions = {
	env?: Record<string, string>;
	/** What opening the browser reports; omit to record nothing opened. */
	opens?: boolean;
};

function capture() {
	const output = { text: "", write: (text: string) => (output.text += text) };
	return output;
}

/** Runs the server CLI until the test calls `stop()`. */
async function startCli(args: string[], { env = {}, opens = true }: CliOptions = {}) {
	const cwd = await tempDir();
	const stdout = capture();
	const stderr = capture();
	const opened: string[] = [];
	const controller = new AbortController();
	const exit = run(args, {
		stdout,
		stderr,
		env,
		cwd,
		signal: controller.signal,
		webDir: cwd,
		openBrowser: (url) => {
			opened.push(url);
			return Promise.resolve(opens);
		},
		deps: { credentials: memoryCredentialsStore() },
	});
	const stop = async () => {
		controller.abort();
		return { code: await exit, stdout: stdout.text, stderr: stderr.text };
	};
	return { cwd, opened, exit, stop, stdout, stderr };
}

function untilListening({ stdout }: { stdout: { text: string } }): Promise<string> {
	return vi.waitFor(() => {
		const [url] = /^http:\S+/u.exec(stdout.text) ?? [];
		if (url === undefined) {
			throw new Error("The server has not printed its URL yet");
		}
		return url;
	});
}

describe("server cli", () => {
	it("prints usage with --help", async () => {
		const { exit, stdout } = await startCli(["--help"]);

		expect(await exit).toBe(0);
		expect(stdout.text).toBe(USAGE);
	});

	it.each([
		["an unknown option", ["--nope"]],
		["an argument", ["pack"]],
		["a port that is not a number", ["--port", "http"]],
		["a port out of range", ["--port", "65536"]],
		["an origin that is not a URL", ["--allow-origin", "localhost"]],
	])("fails with usage for %s", async (_, args) => {
		const { exit, stderr } = await startCli(args);

		expect(await exit).toBe(1);
		expect(stderr.text).toContain(USAGE);
	});

	it("rejects an unknown SIGNAL_STICKERS_ENV", async () => {
		const { exit, stderr } = await startCli([], { env: { SIGNAL_STICKERS_ENV: "dev" } });

		expect(await exit).toBe(1);
		expect(stderr.text).toContain("SIGNAL_STICKERS_ENV must be one of: production, staging");
	});

	it("serves until stopped and opens the browser", async () => {
		const cli = await startCli([]);
		const url = await untilListening(cli);

		const status = await (await fetch(`${url}/api/status`)).json();
		const result = await cli.stop();

		expect(status).toMatchObject({ env: "production" });
		expect(cli.opened).toEqual([url]);
		expect(result).toEqual({
			code: 0,
			stdout: `${url}\n`,
			stderr:
				`Serving Signal production with the pack in ${join(cli.cwd, "pack")}\n` +
				"The web UI is not built, so only the API is available: run pnpm build\n",
		});
	});

	it("selects staging, the pack folder, and no browser", async () => {
		const cli = await startCli(["--staging", "--dir", "cats", "--no-open"]);
		const url = await untilListening(cli);

		const status = await (await fetch(`${url}/api/status`)).json();
		const { stderr } = await cli.stop();

		expect(status).toMatchObject({ env: "staging" });
		expect(stderr).toContain(`Serving Signal staging with the pack in ${join(cli.cwd, "cats")}\n`);
		expect(cli.opened).toEqual([]);
	});

	it("tells the user to open the URL when no browser opens", async () => {
		const cli = await startCli([], { opens: false });
		const url = await untilListening(cli);

		await vi.waitFor(() => {
			expect(cli.stderr.text).toContain(`Could not open a browser: open ${url} yourself\n`);
		});
		await cli.stop();
	});
});
