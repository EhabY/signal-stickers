import { request } from "node:http";
import { join } from "node:path";

import type { Credentials, Pack } from "@signal-stickers/core";
import {
	fakeCdn,
	memoryCredentialsStore,
	PACK_LINK,
	png,
	tempDir,
	writePackFolder,
	type FakeCdnOptions,
	type StickerPackProto,
} from "@signal-stickers/core/testing";
import { onTestFinished, vi } from "vitest";
import { WebSocket, type RawData } from "ws";

import { startServer, type ServerOptions } from "../src/server.ts";

export const CATS: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	stickers: [
		{ id: 0, emoji: "😀" },
		{ id: 1, emoji: "😾" },
	],
};

export type ServeOptions = Partial<ServerOptions> &
	FakeCdnOptions & {
		/** Starts linked with these credentials. */
		linked?: Credentials;
		manifest?: StickerPackProto;
	};

export type Reply = Readonly<{ status: number; body: unknown }>;

/**
 * Starts a server for the current test over a fresh pack folder, in-memory credentials, a fake CDN
 * serving `manifest` (default {@link CATS}), and no validation issues.
 */
export async function serve(options: ServeOptions = {}) {
	const {
		deps,
		linked,
		manifest = CATS,
		images,
		failingStickerId,
		packDir = join(await tempDir(), "pack"),
		...serverOptions
	} = options;
	const credentials = memoryCredentialsStore(linked);
	const logs: string[] = [];
	const server = await startServer({
		env: "production",
		packDir,
		log: (message) => {
			logs.push(message);
		},
		deps: {
			credentials,
			createCdn: () => fakeCdn(manifest, { images, failingStickerId }),
			validatePackFolder: () => Promise.resolve([]),
			...deps,
		},
		...serverOptions,
	});
	onTestFinished(() => server.close());

	const send = async (method: string, path: string, body?: unknown): Promise<Reply> => {
		const response = await fetch(`${server.url}${path}`, { method, body: requestBody(body) });
		return { status: response.status, body: await response.json() };
	};
	return { ...server, packDir, credentials, logs, send, get: (path: string) => send("GET", path) };
}

export type TestServer = Awaited<ReturnType<typeof serve>>;

export const PACK: Pack = {
	title: "Dogs",
	author: "Ehab",
	cover: "001.png",
	stickers: [
		{ file: "001.png", emoji: "🐶" },
		{ file: "002.png", emoji: "🐕" },
	],
};

/** Like {@link serve}, with `pack` (default {@link PACK}) and PACK's images as the working copy. */
export async function servePack({
	pack = PACK,
	...options
}: ServeOptions & { pack?: Pack } = {}): Promise<TestServer> {
	const packDir = await writePackFolder(pack, { "001.png": png(1), "002.png": png(2) });
	return serve({ packDir, ...options });
}

/** Starts a request that the test can cancel, as when the user closes the page. */
export function startRequest(server: TestServer, method: string, path: string, body?: unknown) {
	const controller = new AbortController();
	const response = fetch(`${server.url}${path}`, {
		method,
		body: requestBody(body),
		signal: controller.signal,
	}).catch((error: unknown) => error);
	return {
		response,
		cancel: () => {
			controller.abort();
		},
	};
}

/** Pulls the fake CDN's pack into the working copy. */
export function pull(server: TestServer): Promise<Reply> {
	return server.send("POST", "/api/pull", { link: PACK_LINK });
}

export type RawRequestOptions = Readonly<{
	method?: string;
	path?: string;
	headers?: Record<string, string>;
}>;

/** Sends a request with exactly these headers, which `fetch` would not allow (e.g. `Host`). */
export function rawRequest(
	url: string,
	{ method = "GET", path = "/api/status", headers = {} }: RawRequestOptions,
): Promise<number> {
	const { port } = new URL(url);
	return new Promise((resolve, reject) => {
		request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		})
			.on("error", reject)
			.end();
	});
}

/** Connects to the events WebSocket and collects every event it receives. */
export async function listenForEvents(server: TestServer): Promise<unknown[]> {
	const socket = await openEditor(server.url);
	const received: unknown[] = [];
	socket.on("message", (data) => {
		received.push(parseMessage(data));
	});
	return received;
}

/** Connects to the events WebSocket of the server at `url`, as an editor tab does. */
export async function openEditor(url: string): Promise<WebSocket> {
	const socket = new WebSocket(`${url.replace("http", "ws")}/api/events`, { origin: url });
	onTestFinished(() => {
		socket.terminate();
	});
	await new Promise((resolve, reject) => {
		socket.once("open", resolve).once("error", reject);
	});
	return socket;
}

export async function untilReceived(events: readonly unknown[], count: number): Promise<void> {
	await vi.waitFor(() => {
		if (events.length < count) {
			throw new Error(`Received ${events.length} of ${count} events`);
		}
	});
}

/**
 * A fake core operation that runs until its signal aborts. `started` resolves with that signal, so
 * a test can wait for the operation to begin and then check that it was cancelled.
 */
export function blockUntilAborted() {
	const { promise: started, resolve } = Promise.withResolvers<AbortSignal>();
	const operation = ({ signal }: { signal?: AbortSignal | undefined }): Promise<never> => {
		resolve(signal!);
		return new Promise((_, reject) => {
			signal!.addEventListener("abort", () => {
				reject(new Error("Aborted"));
			});
		});
	};
	return { started, operation };
}

/** Images go as they are; anything else as JSON. */
function requestBody(body: unknown): Exclude<RequestInit["body"], undefined> {
	if (body === undefined) {
		return null;
	}
	return body instanceof Uint8Array ? body : JSON.stringify(body);
}

function parseMessage(data: RawData): unknown {
	const bytes = Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data);
	return JSON.parse(new TextDecoder().decode(bytes));
}
