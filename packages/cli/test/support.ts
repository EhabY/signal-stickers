import type {
	CdnClient,
	CredentialsStore,
	Environment,
	linkDevice,
	pushPack,
	unlinkDevice,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeCdn,
	fakeChat,
	memoryCredentialsStore,
	PACK_LINK,
	PACK_LOCATOR,
	tempDir,
	type FakeChat,
	type StickerPackProto,
} from "@signal-stickers/core/testing";
import { vi } from "vitest";

import { run } from "../src/cli.ts";
import type { CliContext } from "../src/context.ts";

export const CATS: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	stickers: [{ id: 0, emoji: "😀" }],
};

export const QR_URL = "sgnl://linkdevice?uuid=address&pub_key=key&capabilities=nopni,nopni2";

export type CliOptions = Pick<CliContext, "linkDevice" | "pushPack" | "unlinkDevice"> & {
	env?: Record<string, string>;
	/** Makes both stdout and stderr terminals. */
	isTTY?: boolean;
	cdn?: CdnClient;
	chat?: FakeChat;
	credentialsStore?: CredentialsStore;
};

/**
 * Runs the CLI in a fresh working directory with captured output. Every service and stored
 * credential is a fake; operations a test does not pass fail if called.
 */
export async function runCli(
	args: string[],
	{
		env = {},
		isTTY = false,
		cdn = fakeCdn(CATS),
		chat = unusedChat(),
		credentialsStore = memoryCredentialsStore(),
		linkDevice = unexpected("linkDevice"),
		pushPack = unexpected("pushPack"),
		unlinkDevice = unexpected("unlinkDevice"),
	}: CliOptions = {},
) {
	const cwd = await tempDir();
	const { signal } = new AbortController();
	const stdout = capture(isTTY);
	const stderr = capture(isTTY);
	const cdnEnvs: Environment[] = [];
	const code = await run(args, {
		stdout,
		stderr,
		env,
		cwd,
		signal,
		createCdn: (selected) => {
			cdnEnvs.push(selected);
			return cdn;
		},
		createChat: chat.factory,
		credentialsStore,
		linkDevice,
		pushPack,
		unlinkDevice,
	});
	return { code, cwd, signal, stdout: stdout.text, stderr: stderr.text, cdnEnvs };
}

/**
 * A `linkDevice` that reports every step and links {@link CREDENTIALS} in the selected env, or
 * fails with `failure` once the QR code is shown.
 */
export function fakeLinkDevice(failure?: Error) {
	return vi.fn<typeof linkDevice>(({ env, onProgress }) => {
		onProgress?.({ step: "connecting" });
		onProgress?.({ step: "waitingForScan", qrUrl: QR_URL });
		if (failure) {
			return Promise.reject(failure);
		}
		onProgress?.({ step: "registering" });
		onProgress?.({ step: "done" });
		return Promise.resolve({ ...CREDENTIALS, env });
	});
}

/** A `pushPack` that reports two uploads and returns {@link PACK_LINK}, or fails with `failure`. */
export function fakePushPack(failure?: Error) {
	return vi.fn<typeof pushPack>(({ onProgress }) => {
		if (failure) {
			return Promise.reject(failure);
		}
		onProgress?.({ done: 1, total: 2 });
		onProgress?.({ done: 2, total: 2 });
		return Promise.resolve({ locator: PACK_LOCATOR, link: PACK_LINK });
	});
}

/** An `unlinkDevice` that succeeds, or fails with `failure`. */
export function fakeUnlinkDevice(failure?: Error) {
	return vi.fn<typeof unlinkDevice>(() => (failure ? Promise.reject(failure) : Promise.resolve()));
}

/** A chat service for tests whose fake operations never call it; every request fails. */
export function unusedChat(): FakeChat {
	return fakeChat(unexpected("chat request"));
}

function unexpected(name: string) {
	return () => Promise.reject(new Error(`Unexpected ${name}`));
}

function capture(isTTY: boolean) {
	const output = { text: "", isTTY, write: (text: string) => (output.text += text) };
	return output;
}
