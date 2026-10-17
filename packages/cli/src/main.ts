import { run } from "./cli.ts";

const controller = new AbortController();
process.once("SIGINT", () => {
	controller.abort();
});

process.exitCode = await run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	// `pnpm pull` runs from the repo root, and INIT_CWD is where the user ran it. The bundle compiles
	// this out so the installed CLI always uses its real working directory.
	cwd: process.env.INIT_CWD ?? process.cwd(),
	signal: controller.signal,
});
