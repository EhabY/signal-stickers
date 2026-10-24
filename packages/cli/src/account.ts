import {
	createCredentialsStore,
	credentialsWarning,
	getLinkStatus,
	linkDevice,
	saveLinkedCredentials,
	unlinkDevice,
	type Credentials,
	type CredentialsStore,
	type Environment,
	type LinkProgress,
} from "@signal-stickers/core";

import {
	assertNoArguments,
	terminalQr,
	type CliContext,
	type CommandOptions,
	type Output,
} from "./context.ts";

const STEP_LINES: Record<Exclude<LinkProgress["step"], "waitingForScan">, string> = {
	connecting: "Connecting\n",
	registering: "Registering this device\n",
	done: "",
};
const SCAN_INSTRUCTIONS =
	"Scan this code in the Signal app on your phone: Settings > Linked devices > Link new device";
const REMOVE_ON_PHONE =
	'If "signal-stickers" is still in Linked devices in Signal on your phone (Settings > Linked devices), remove it there.';

/** Links this tool as a new device and saves its credentials, unless it is already linked. */
export async function link(
	args: readonly string[],
	{ env }: CommandOptions,
	{
		stdout,
		stderr,
		signal,
		createChat,
		credentialsStore,
		linkDevice: linkNewDevice = linkDevice,
	}: CliContext,
): Promise<void> {
	assertNoArguments("link", args);
	const store = credentialsStore ?? createCredentialsStore();
	const saved = await store.load();
	if (saved) {
		throw new Error(
			`Already linked to Signal ${saved.env} as device ${saved.deviceId}. Run "signal-stickers unlink" first.`,
		);
	}
	stderr.write(`Linking to Signal ${env}\n`);
	const credentials = await withLinkProgress(stderr, (onProgress) =>
		linkNewDevice({ env, createChat, signal, onProgress }),
	);
	await saveLinkedCredentials(store, credentials);
	stdout.write(`Linked to Signal ${env} as device ${credentials.deviceId}\n`);
	stderr.write(`${credentialsWarning(store.path)}\n`);
}

/**
 * Prints which account and environment this tool is linked to, never the password, and warns when
 * the selected environment is another one.
 */
export async function status(
	args: readonly string[],
	{ env }: CommandOptions,
	{ stdout, stderr, credentialsStore }: CliContext,
): Promise<void> {
	assertNoArguments("status", args);
	const store = credentialsStore ?? createCredentialsStore();
	const linkStatus = getLinkStatus(await store.load());
	if (!linkStatus.linked) {
		stdout.write(`Not linked. Run "signal-stickers link" to link this tool as a Signal device.\n`);
		return;
	}
	const { deviceId, aci, number, createdAt } = linkStatus;
	const lines = [
		`Linked to Signal ${linkStatus.env} as device ${deviceId}`,
		`Account: ${aci}`,
		...(number === undefined ? [] : [`Phone number: ${number}`]),
		`Linked at: ${createdAt}`,
		`Credentials: ${store.path}`,
	];
	stdout.write(lines.map((line) => `${line}\n`).join(""));
	if (linkStatus.env !== env) {
		stderr.write(`Warning: ${describeOtherEnvironment(linkStatus.env, env)}\n`);
	}
}

/**
 * Removes this device from the account, in the environment it was linked in whatever `--staging`
 * says, then deletes its saved credentials. With `local`, only deletes the credentials, for a device
 * Signal cannot be asked to remove or credentials that no longer load.
 */
export async function unlink(
	args: readonly string[],
	{ local }: CommandOptions,
	{
		stdout,
		stderr,
		signal,
		createChat,
		credentialsStore,
		unlinkDevice: removeDevice = unlinkDevice,
	}: CliContext,
): Promise<void> {
	assertNoArguments("unlink [--local]", args);
	const store = credentialsStore ?? createCredentialsStore();
	if (local) {
		if (await store.delete()) {
			stdout.write(`Deleted ${store.path}\n`);
			stderr.write(`${REMOVE_ON_PHONE}\n`);
		} else {
			stdout.write("Not linked\n");
		}
		return;
	}
	const credentials = await store.load();
	if (!credentials) {
		stdout.write("Not linked\n");
		return;
	}
	stderr.write(`Unlinking device ${credentials.deviceId} from Signal ${credentials.env}\n`);
	await removeDevice({ credentials, createChat, signal }).catch(suggestLocalUnlink);
	await store.delete();
	stdout.write(`Unlinked and deleted ${store.path}\n`);
}

/** Loads the saved credentials, failing unless they exist and belong to `env`. */
export async function loadCredentials(
	store: CredentialsStore,
	env: Environment,
): Promise<Credentials> {
	const credentials = await store.load();
	if (!credentials) {
		throw new Error(`Not linked. Run "signal-stickers link" first.`);
	}
	assertLinkedTo(env, credentials);
	return credentials;
}

/** Runs `start`, printing its steps in order even though QR codes render asynchronously. */
async function withLinkProgress<T>(
	output: Output,
	start: (onProgress: (progress: LinkProgress) => void) => Promise<T>,
): Promise<T> {
	let printed: Promise<unknown> = Promise.resolve();
	try {
		return await start((progress) => {
			// A failed print must not hide whether linking worked, so it only skips that step.
			printed = printed
				.then(() => describeLinkStep(progress))
				.then((text) => output.write(text))
				.catch(() => null);
		});
	} finally {
		await printed;
	}
}

function describeOtherEnvironment(linked: Environment, selected: Environment): string {
	const fix = linked === "staging" ? "Add --staging" : "Remove --staging and SIGNAL_STICKERS_ENV";
	return `Linked to Signal ${linked}, not ${selected}. ${fix} to use it.`;
}

function suggestLocalUnlink(error: unknown): never {
	if (error instanceof Error && error.name !== "AbortError") {
		throw new Error(
			`${error.message.replace(/\.$/u, "")}. If Signal can't be reached, run ` +
				'"signal-stickers unlink --local" to delete the saved credentials instead.',
			{ cause: error },
		);
	}
	throw error;
}

function assertLinkedTo(env: Environment, credentials: Credentials): void {
	if (credentials.env !== env) {
		throw new Error(describeOtherEnvironment(credentials.env, env));
	}
}

async function describeLinkStep(progress: LinkProgress): Promise<string> {
	if (progress.step === "waitingForScan") {
		return `${await terminalQr(progress.qrUrl)}\n${SCAN_INSTRUCTIONS}\n`;
	}
	return STEP_LINES[progress.step];
}
