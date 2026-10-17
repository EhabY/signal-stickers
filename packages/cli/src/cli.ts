import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
	createCdnClient,
	ENVIRONMENTS,
	isEnvironment,
	parsePackLink,
	pullPack,
	type CdnClient,
	type Environment,
	type Pack,
	type PullProgress,
} from "@signal-stickers/core";

export type Output = { write(text: string): unknown; isTTY?: boolean };

export type CliContext = Readonly<{
	stdout: Output;
	stderr: Output;
	env: Readonly<Record<string, string | undefined>>;
	/** Directory that relative paths resolve against. */
	cwd: string;
	signal?: AbortSignal;
	createCdn?: (env: Environment) => CdnClient;
}>;

export const USAGE = `Usage: signal-stickers <command> [options]

Commands:
  pull <link> [dir]   Download and decrypt a sticker pack into dir (default: ./pack)

Options:
  --staging           Use Signal's staging servers (or SIGNAL_STICKERS_ENV=staging)
  -h, --help          Show this help
`;

class UsageError extends Error {}

/** Runs the CLI and returns the process exit code. */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: [...args],
			allowPositionals: true,
			options: { staging: { type: "boolean" }, help: { type: "boolean", short: "h" } },
		});
		const [command, ...rest] = positionals;
		if (values.help === true) {
			context.stdout.write(USAGE);
			return 0;
		}
		const env = resolveEnvironment(values.staging, context.env);
		switch (command) {
			case "pull":
				await pull(rest, env, context);
				return 0;
			case undefined:
				throw new UsageError("Missing command");
			default:
				throw new UsageError(`Unknown command: ${command}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.stderr.write(`Error: ${message}\n`);
		if (error instanceof UsageError || isParseArgsError(error)) {
			context.stderr.write(`\n${USAGE}`);
		}
		return 1;
	}
}

function resolveEnvironment(staging: boolean | undefined, env: CliContext["env"]): Environment {
	if (staging === true) {
		return "staging";
	}
	const value = env.SIGNAL_STICKERS_ENV;
	if (value === undefined || value === "") {
		return "production";
	}
	if (!isEnvironment(value)) {
		throw new UsageError(`SIGNAL_STICKERS_ENV must be one of: ${ENVIRONMENTS.join(", ")}`);
	}
	return value;
}

async function pull(
	[link, dir = "pack", ...extra]: string[],
	env: Environment,
	{ stdout, stderr, cwd, signal, createCdn = defaultCdn }: CliContext,
): Promise<void> {
	if (link === undefined || extra.length > 0) {
		throw new UsageError("Usage: pull <link> [dir]");
	}
	const locator = parsePackLink(link);
	const target = resolve(cwd, dir);
	stderr.write(`Pulling from Signal ${env} into ${target}\n`);
	const progress = progressLine(stderr);
	const pack = await pullPack({
		locator,
		dir: target,
		cdn: createCdn(env),
		signal,
		onProgress: progress.update,
	}).finally(progress.end);
	stdout.write(`${summarize(pack)} into ${target}\n`);
}

function defaultCdn(env: Environment): CdnClient {
	return createCdnClient({ env });
}

/** On a terminal, redraws one line in place; elsewhere, prints a line per update. */
function progressLine(output: Output) {
	let open = false;
	return {
		update: ({ done, total }: PullProgress) => {
			const line = `Downloaded ${done}/${total}`;
			if (output.isTTY === true) {
				output.write(`\r${line}`);
				open = true;
			} else {
				output.write(`${line}\n`);
			}
		},
		end: () => {
			if (open) {
				output.write("\n");
				open = false;
			}
		},
	};
}

function summarize({ title, author, stickers }: Pack): string {
	const name = title === "" ? "an untitled pack" : `"${title}"`;
	const by = author === "" ? "" : ` by ${author}`;
	const count = `${stickers.length} ${stickers.length === 1 ? "sticker" : "stickers"}`;
	return `Pulled ${name}${by}: ${count}`;
}

function isParseArgsError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("ERR_PARSE_ARGS_")
	);
}
