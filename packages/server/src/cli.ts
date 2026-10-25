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
import {
	findRecordedServer,
	recordServer,
	serverRecordFile,
	type RecordedServer,
} from "./serverRecord.ts";

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
	/** How long the server waits for a closed editor to reconnect before stopping. */
	idleMs?: number;
	deps?: Partial<ServerDeps>;
}>;

export const USAGE = `Usage: signal-stickers-server [options]

Starts the sticker pack editor on this computer and opens it in your browser. It
stops once the editor closes, and starting it again for the same pack reopens it.

Options:
  --dir <path>          Working copy of the pack (default: a "pack" folder in this
                        tool's config directory, printed at startup)
  --port <number>       Port to listen on (default: any free port)
  --allow-origin <url>  Also accept requests from this origin, e.g. the web dev server
  --no-open             Do not open a browser, and serve until stopped
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
		const configDir = context.configDir ?? defaultConfigDir({ env: context.env });
		await serve(
			{
				env: resolveEnvironment(values.staging, context.env),
				configDir,
				packDir:
					values.dir === undefined ? join(configDir, "pack") : resolve(context.cwd, values.dir),
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
	configDir: string;
	packDir: string;
	port: number;
	allowedOrigins: string[];
	open: boolean;
}>;

async function serve(
	{ open, configDir, ...options }: ServeOptions,
	context: ServerCliContext,
): Promise<void> {
	const { stdout, stderr, webDir = DEFAULT_WEB_DIR, openBrowser: openUrl } = context;
	const record = serverRecordFile(configDir, options.packDir);
	const running = await findRecordedServer(record);
	if (running) {
		await reopen(running, { open, ...options }, context);
		return;
	}
	const closed = new AbortController();
	const server = await startServer({
		...options,
		webDir,
		deps: context.deps,
		log: (message) => {
			stderr.write(`${message}\n`);
		},
		// With --no-open, editors may come and go.
		onIdle: open
			? () => {
					closed.abort();
				}
			: undefined,
		idleMs: context.idleMs,
	});
	const forget = await recordServer(record, server.url);
	stderr.write(`Serving Signal ${options.env} with the pack in ${options.packDir}\n`);
	// With --allow-origin, the web UI is usually served by the Vite dev server.
	if (options.allowedOrigins.length === 0 && !(await exists(join(webDir, "index.html")))) {
		stderr.write("The web UI is not built, so only the API is available: run pnpm build\n");
	}
	stdout.write(`${server.url}\n`);
	if (open) {
		void openInBrowser(server.url, stderr, openUrl);
	}
	const stopped = AbortSignal.any([context.signal, closed.signal]);
	if (!stopped.aborted) {
		await once(stopped, "abort");
	}
	if (closed.signal.aborted) {
		stderr.write("Stopping, since the editor was closed\n");
	}
	await server.close();
	await forget();
}

/** Opens the server that already serves the pack, rather than serving it twice. */
async function reopen(
	running: RecordedServer,
	{ env, packDir, open }: Pick<ServeOptions, "env" | "packDir" | "open">,
	{ stdout, stderr, openBrowser: openUrl }: ServerCliContext,
): Promise<void> {
	if (running.env !== env) {
		throw new Error(
			`Signal ${running.env} is already serving the pack in ${packDir} at ${running.url}; stop it first`,
		);
	}
	stderr.write(`Already serving the pack in ${packDir}\n`);
	stdout.write(`${running.url}\n`);
	if (open) {
		await openInBrowser(running.url, stderr, openUrl);
	}
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
