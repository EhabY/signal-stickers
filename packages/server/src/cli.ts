import { once } from "node:events";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
	defaultConfigDir,
	resolveEnvironment,
	UnknownEnvironmentError,
	type Environment,
} from "@signal-stickers/core";

import { openBrowser } from "./browser.ts";
import type { ServerDeps } from "./routes.ts";
import { startServer } from "./server.ts";

export type Output = { write(text: string): unknown };

export type ServerCliContext = Readonly<{
	stdout: Output;
	stderr: Output;
	env: Readonly<Record<string, string | undefined>>;
	/** Directory that relative paths resolve against. */
	cwd: string;
	/** Stops the server. */
	signal: AbortSignal;
	/** Holds the default working copy; defaults to the tool's own config directory. */
	configDir?: string;
	/** Defaults to the built web UI in `packages/web/dist`. */
	webDir?: string;
	openBrowser?: (url: string) => Promise<boolean>;
	deps?: Partial<ServerDeps>;
}>;

export const USAGE = `Usage: signal-stickers-server [options]

Starts the sticker pack editor on this computer and opens it in your browser.

Options:
  --dir <path>          Working copy of the pack (default: a "pack" folder in this
                        tool's config directory, printed at startup)
  --port <number>       Port to listen on (default: any free port)
  --allow-origin <url>  Also accept requests from this origin, e.g. the web dev server
  --no-open             Do not open a browser
  --staging             Use Signal's staging servers (or SIGNAL_STICKERS_ENV=staging)
  -h, --help            Show this help
`;

const DEFAULT_WEB_DIR = join(import.meta.dirname, "../../web/dist");

class UsageError extends Error {}

/** Runs the server until `context.signal` aborts and returns the process exit code. */
export async function run(args: readonly string[], context: ServerCliContext): Promise<number> {
	try {
		const { values } = parseArgs({
			args: [...args],
			allowNegative: true,
			options: {
				dir: { type: "string" },
				port: { type: "string" },
				"allow-origin": { type: "string", multiple: true, default: [] },
				open: { type: "boolean", default: true },
				staging: { type: "boolean" },
				help: { type: "boolean", short: "h" },
			},
		});
		if (values.help === true) {
			context.stdout.write(USAGE);
			return 0;
		}
		await serve(
			{
				env: resolveEnvironment(values.staging, context.env),
				packDir: resolvePackDir(values.dir, context),
				port: parsePort(values.port),
				allowedOrigins: values["allow-origin"].map(parseOrigin),
				open: values.open,
			},
			context,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.stderr.write(`Error: ${message}\n`);
		if (
			error instanceof UsageError ||
			error instanceof UnknownEnvironmentError ||
			isParseArgsError(error)
		) {
			context.stderr.write(`\n${USAGE}`);
		}
		return 1;
	}
}

function resolvePackDir(
	dir: string | undefined,
	{ cwd, env, configDir = defaultConfigDir({ env }) }: ServerCliContext,
): string {
	return dir === undefined ? join(configDir, "pack") : resolve(cwd, dir);
}

function parsePort(value = "0"): number {
	const port = Number(value);
	if (!/^\d+$/u.test(value) || port > 65_535) {
		throw new UsageError(`--port must be a number from 0 to 65535: ${value}`);
	}
	return port;
}

function parseOrigin(value: string): string {
	const origin = URL.canParse(value) ? new URL(value).origin : "null";
	if (origin === "null") {
		throw new UsageError(`--allow-origin must be an origin like http://localhost:5173: ${value}`);
	}
	return origin;
}

type ServeOptions = Readonly<{
	env: Environment;
	packDir: string;
	port: number;
	allowedOrigins: string[];
	open: boolean;
}>;

async function serve(
	{ open, ...options }: ServeOptions,
	{
		stdout,
		stderr,
		signal,
		webDir = DEFAULT_WEB_DIR,
		deps,
		openBrowser: openUrl,
	}: ServerCliContext,
): Promise<void> {
	const server = await startServer({
		...options,
		webDir,
		deps,
		log: (message) => {
			stderr.write(`${message}\n`);
		},
	});
	stderr.write(`Serving Signal ${options.env} with the pack in ${options.packDir}\n`);
	if (!(await exists(join(webDir, "index.html")))) {
		stderr.write("The web UI is not built, so only the API is available: run pnpm build\n");
	}
	stdout.write(`${server.url}\n`);
	if (open) {
		void openInBrowser(server.url, stderr, openUrl);
	}
	if (!signal.aborted) {
		await once(signal, "abort");
	}
	await server.close();
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function openInBrowser(
	url: string,
	stderr: Output,
	open: (url: string) => Promise<boolean> = openBrowser,
): Promise<void> {
	if (!(await open(url))) {
		stderr.write(`Could not open a browser: open ${url} yourself\n`);
	}
}

function isParseArgsError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("ERR_PARSE_ARGS_")
	);
}
