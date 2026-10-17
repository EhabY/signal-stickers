import { parseArgs } from "node:util";

import { ENVIRONMENTS, isEnvironment, type Environment } from "@signal-stickers/core";

import { link, status, unlink } from "./account.ts";
import { UsageError, type CliContext } from "./context.ts";
import { pull } from "./pull.ts";

export const USAGE = `Usage: signal-stickers <command> [options]

Commands:
  link                Link this tool as a device of your Signal account
  pull <link> [dir]   Download and decrypt a sticker pack into dir (default: ./pack)
  status              Show which account this tool is linked to
  unlink              Remove this device from your account and delete its credentials

Options:
  --staging           Use Signal's staging servers (or SIGNAL_STICKERS_ENV=staging)
  -h, --help          Show this help
`;

type Command = (args: readonly string[], env: Environment, context: CliContext) => Promise<void>;

const COMMANDS = new Map<string, Command>([
	["link", link],
	["pull", pull],
	["status", status],
	["unlink", unlink],
]);

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
		if (command === undefined) {
			throw new UsageError("Missing command");
		}
		const runCommand = COMMANDS.get(command);
		if (!runCommand) {
			throw new UsageError(`Unknown command: ${command}`);
		}
		await runCommand(rest, env, context);
		return 0;
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

function isParseArgsError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("ERR_PARSE_ARGS_")
	);
}
