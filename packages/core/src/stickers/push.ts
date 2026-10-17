import type { CdnClient } from "../net/cdn.ts";
import type { ChatClient } from "../net/chat.ts";
import { NotImplementedError } from "../util/notImplemented.ts";
import type { PackLocator } from "./link.ts";

/** Finished uploads out of all of them, the manifest included. */
export type PushProgress = Readonly<{ done: number; total: number }>;

export type PushOptions = Readonly<{
	/** A pack folder as `pullPack` writes it. */
	dir: string;
	/** Authenticated as the linked device, e.g. with `getChatAuth`. */
	chat: ChatClient;
	cdn: CdnClient;
	signal?: AbortSignal | undefined;
	onProgress?: ((progress: PushProgress) => void) | undefined;
}>;

export type PushResult = Readonly<{ locator: PackLocator; link: string }>;

/**
 * Uploads the pack in `dir` as a new pack under a fresh random key and returns its link. Throws
 * `PackValidationError` before any request when the pack is invalid.
 */
export function pushPack(_options: PushOptions): Promise<PushResult> {
	return Promise.reject(new NotImplementedError("pushPack"));
}
