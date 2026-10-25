#!/usr/bin/env node
import { run } from "./cli.ts";

const controller = new AbortController();
// SIGHUP: the terminal running the server closed.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.once(signal, () => {
		controller.abort();
	});
}

process.exitCode = await run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	// `pnpm start` runs in this package, and INIT_CWD is where the user ran it.
	cwd: process.env.INIT_CWD ?? process.cwd(),
	signal: controller.signal,
});
