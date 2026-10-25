import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import { memoryCredentialsStore, tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it, onTestFinished, vi, type Mock } from "vitest";

import { run, USAGE } from "../src/cli.ts";
import { serverRecordFile } from "../src/serverRecord.ts";
import type { TrayActions } from "../src/tray.ts";
import { openEditor } from "./support.ts";

type CliOptions = {
	env?: Record<string, string>;
	/** What opening the browser reports; omit to record nothing opened. */
	opens?: boolean;
	/** Shares the config directory, and so the default pack, with an earlier run. */
	configDir?: string;
};

function capture() {
	const output = { text: "", write: (text: string) => (output.text += text) };
	return output;
}

/** Runs the server CLI until the test calls `stop()`. */
async function startCli(args: string[], options: CliOptions = {}) {
	const cwd = await tempDir();
	const { env = {}, opens = true, configDir = join(cwd, "config") } = options;
	const stdout = capture();
	const stderr = capture();
	const opened: string[] = [];
	const tray: { actions?: TrayActions; close: Mock<() => void> } = { close: vi.fn<() => void>() };
	const controller = new AbortController();
	const exit = run(args, {
		stdout,
		stderr,
		env,
		cwd,
		signal: controller.signal,
		configDir,
		webDir: cwd,
		idleMs: 10,
		openBrowser: (url) => {
			opened.push(url);
			return Promise.resolve(opens);
		},
		deps: { credentials: memoryCredentialsStore() },
		showTray: (actions) => {
			tray.actions = actions;
			return tray.close;
		},
	});
	const stop = async () => {
		controller.abort();
		return { code: await exit, stdout: stdout.text, stderr: stderr.text };
	};
	return { cwd, configDir, opened, tray, exit, stop, stdout, stderr };
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
				`Serving Signal production with the pack in ${join(cli.cwd, "config", "pack")}\n` +
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

	it("leaves the web UI to the dev server it accepts requests from", async () => {
		const cli = await startCli(["--allow-origin", "http://localhost:5173", "--no-open"]);
		await untilListening(cli);

		const { stderr } = await cli.stop();

		expect(stderr).toBe(
			`Serving Signal production with the pack in ${join(cli.cwd, "config", "pack")}\n`,
		);
	});

	it("tells the user to open the URL when no browser opens", async () => {
		const cli = await startCli([], { opens: false });
		const url = await untilListening(cli);

		await vi.waitFor(() => {
			expect(cli.stderr.text).toContain(`Could not open a browser: open ${url} yourself\n`);
		});
		await cli.stop();
	});

	it("stops once the editor it opened closes", async () => {
		const cli = await startCli([]);
		const editor = await openEditor(await untilListening(cli));

		editor.close();

		expect(await cli.exit).toBe(0);
		expect(cli.stderr.text).toContain("Stopping, since the editor was closed\n");
	});

	it("opens the server already running for the same pack", async () => {
		const first = await startCli([]);
		const url = await untilListening(first);

		const second = await startCli([], { configDir: first.configDir });

		expect(await second.exit).toBe(0);
		expect(second.stdout.text).toBe(`${url}\n`);
		expect(second.opened).toEqual([url]);
		await first.stop();
	});

	it("refuses to serve a pack that another environment is serving", async () => {
		const first = await startCli([]);
		const url = await untilListening(first);

		const second = await startCli(["--staging"], { configDir: first.configDir });

		expect(await second.exit).toBe(1);
		expect(second.stderr.text).toContain(
			`Signal production is already serving the pack in ${join(first.configDir, "pack")} at ${url}; stop it first`,
		);
		await first.stop();
	});

	it("starts over a server that stopped without cleaning up", async () => {
		const configDir = join(await tempDir(), "config");
		const record = serverRecordFile(configDir, join(configDir, "pack"));
		await mkdir(dirname(record), { recursive: true });
		await writeFile(record, JSON.stringify({ url: "http://127.0.0.1:1" }));

		const cli = await startCli([], { configDir });
		await untilListening(cli);
		const { stderr } = await cli.stop();

		expect(stderr).toContain("Serving Signal production");
	});

	it("stops when the tray quits, and closes the tray", async () => {
		const cli = await startCli([]);
		await untilListening(cli);

		cli.tray.actions?.quit();

		expect(await cli.exit).toBe(0);
		expect(cli.stderr.text).toContain("Stopping, as chosen from the tray");
		expect(cli.tray.close).toHaveBeenCalledOnce();
	});

	it("opens the editor from the tray", async () => {
		const cli = await startCli(["--no-open"]);
		const url = await untilListening(cli);

		cli.tray.actions?.open();

		await vi.waitFor(() => {
			expect(cli.opened).toEqual([url]);
		});
		await cli.stop();
	});

	it("falls back to a free port when its usual one is taken", async () => {
		const taken = createServer();
		// Something else may already hold the port, which also suits this test.
		await new Promise<void>((resolve) => {
			taken.once("error", () => {
				resolve();
			});
			taken.listen(27_183, "127.0.0.1", resolve);
		});
		onTestFinished(() => {
			taken.close(() => {});
		});

		const cli = await startCli([]);
		const url = await untilListening(cli);
		await cli.stop();

		expect(new URL(url).port).not.toBe("27183");
	});
});
