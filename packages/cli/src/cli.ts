import { parseArgs } from "node:util";

import {
	PackValidationError,
	resolveEnvironment,
	UnknownEnvironmentError,
} from "@signal-stickers/core";

import { link, status, unlink } from "./account.ts";
import { UsageError, type CliContext, type CommandOptions } from "./context.ts";
import { pull } from "./pull.ts";
import { push } from "./push.ts";

export const USAGE = `Usage: signal-stickers <command> [options]

Commands:
  link                Link this tool as a device of your Signal account
  pull <link> [dir]   Download and decrypt a sticker pack into dir (default: ./pack)
  push [dir]          Upload the pack in dir (default: ./pack) as a new sticker pack
  status              Show which account this tool is linked to
  unlink [--local]    Remove this device from your account and delete its credentials;
                      with --local, only delete the credentials, without contacting Signal

Options:
  --staging           Use Signal's staging servers (or SIGNAL_STICKERS_ENV=staging)
  -h, --help          Show this help
`;

type Command = (
	args: readonly string[],
	options: CommandOptions,
	context: CliContext,
) => Promise<void>;

const COMMANDS = new Map<string, Command>([
	["link", link],
	["pull", pull],
	["push", push],
	["status", status],
	["unlink", unlink],
]);

/** Runs the CLI and returns the process exit code. */
export async function run(args: readonly string[], context: CliContext): Promise<number> {
	try {
		const { values, positionals } = parseArgs({
			args: [...args],
			allowPositionals: true,
			options: {
				staging: { type: "boolean" },
				local: { type: "boolean", default: false },
				help: { type: "boolean", short: "h" },
			},
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
		if (values.local && command !== "unlink") {
			throw new UsageError("--local only works with unlink");
		}
		await runCommand(rest, { env, local: values.local }, context);
		return 0;
	} catch (error) {
		context.stderr.write(`Error: ${describeError(error)}\n`);
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

function describeError(error: unknown): string {
	if (error instanceof PackValidationError) {
		const issues = error.issues.map(({ message }) => `\n  - ${message}`);
		return `The pack is not ready to push:${issues.join("")}`;
	}
	return error instanceof Error ? error.message : String(error);
}

function isParseArgsError(error: unknown): boolean {
	return (
		error instanceof TypeError &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("ERR_PARSE_ARGS_")
	);
}
