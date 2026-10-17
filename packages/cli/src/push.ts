import { resolve } from "node:path";

import {
	createChatClient,
	createCredentialsStore,
	getChatAuth,
	pushPack,
} from "@signal-stickers/core";

import { loadCredentials } from "./account.ts";
import {
	defaultCdn,
	progressLine,
	terminalQr,
	UsageError,
	type CliContext,
	type CommandOptions,
} from "./context.ts";

/** Uploads the pack in `dir` as a new pack and prints its link, with a QR code on a terminal. */
export async function push(
	[dir = "pack", ...extra]: readonly string[],
	{ env }: CommandOptions,
	{
		stdout,
		stderr,
		cwd,
		signal,
		createCdn = defaultCdn,
		createChat = createChatClient,
		credentialsStore,
		pushPack: upload = pushPack,
	}: CliContext,
): Promise<void> {
	if (extra.length > 0) {
		throw new UsageError("Usage: push [dir]");
	}
	const credentials = await loadCredentials(credentialsStore ?? createCredentialsStore(), env);
	const target = resolve(cwd, dir);
	stderr.write(`Pushing ${target} to Signal ${env}\n`);
	const progress = progressLine(stderr, "Uploaded");
	const { link } = await upload({
		dir: target,
		chat: createChat({ env, auth: getChatAuth(credentials) }),
		cdn: createCdn(env),
		signal,
		onProgress: progress.update,
	}).finally(progress.end);
	stdout.write(`${link}\n`);
	if (stdout.isTTY === true) {
		stdout.write(`${await terminalQr(link)}\n`);
	}
}
