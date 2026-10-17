import { createCdnClient, type CdnClient, type Environment } from "@signal-stickers/core";

export type Output = { write(text: string): unknown; isTTY?: boolean };

/** Everything a command touches outside its arguments, so tests can swap each piece. */
export type CliContext = Readonly<{
	stdout: Output;
	stderr: Output;
	env: Readonly<Record<string, string | undefined>>;
	/** Directory that relative paths resolve against. */
	cwd: string;
	signal?: AbortSignal;
	createCdn?: (env: Environment) => CdnClient;
}>;

export function defaultCdn(env: Environment): CdnClient {
	return createCdnClient({ env });
}

/** A mistake in the command line; the CLI prints the usage after it. */
export class UsageError extends Error {}

/** On a terminal, redraws one line in place; elsewhere, prints a line per update. */
export function progressLine(output: Output, verb: string) {
	let open = false;
	return {
		update: ({ done, total }: { done: number; total: number }) => {
			const line = `${verb} ${done}/${total}`;
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
