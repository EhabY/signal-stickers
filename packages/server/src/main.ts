#!/usr/bin/env node
import { isSea } from "node:sea";

import { run } from "./cli.ts";
import { unpackAssets } from "./executableAssets.ts";
import { showTray } from "./tray.ts";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.once(signal, () => {
		controller.abort();
	});
}

const assets = isSea() ? await unpackAssets() : undefined;
process.exitCode = await run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	// `pnpm start` runs in this package, and INIT_CWD is where the user ran it.
	cwd: process.env.INIT_CWD ?? process.cwd(),
	signal: controller.signal,
	webDir: assets?.webDir,
	showTray: assets ? (actions) => showTray(assets.tray, [], actions) : undefined,
});
