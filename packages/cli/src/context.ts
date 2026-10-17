import {
	createCdnClient,
	type CdnClient,
	type ChatClientFactory,
	type CredentialsStore,
	type Environment,
	type linkDevice,
	type pushPack,
	type unlinkDevice,
} from "@signal-stickers/core";
import { toString as renderQr } from "qrcode";

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
	createChat?: ChatClientFactory;
	/** Defaults to the tool's own config directory. */
	credentialsStore?: CredentialsStore;
	linkDevice?: typeof linkDevice;
	pushPack?: typeof pushPack;
	unlinkDevice?: typeof unlinkDevice;
}>;

export function defaultCdn(env: Environment): CdnClient {
	return createCdnClient({ env });
}

/** A mistake in the command line; the CLI prints the usage after it. */
export class UsageError extends Error {}

export function assertNoArguments(command: string, args: readonly string[]): void {
	if (args.length > 0) {
		throw new UsageError(`Usage: ${command}`);
	}
}

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

/** Renders `text` as a QR code of half-block characters for a terminal. */
export function terminalQr(text: string): Promise<string> {
	return renderQr(text, { type: "terminal", small: true });
}
