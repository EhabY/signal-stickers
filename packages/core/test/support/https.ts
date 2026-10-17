import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";

import { onTestFinished } from "vitest";

const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, "../fixtures", name), "utf8");

/** The self-signed certificate {@link serveHttps} uses; pin it as the CA to trust that server. */
export const TEST_CA = fixture("localhost.crt");
const TEST_KEY = fixture("localhost.key");

export type HttpsHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** Starts an HTTPS server on loopback that stops when the current test finishes; returns its origin. */
export async function serveHttps(handler: HttpsHandler): Promise<string> {
	const server = createServer({ cert: TEST_CA, key: TEST_KEY }, (req, res) => {
		// A failing handler drops the connection so the client fails instead of hanging.
		Promise.resolve()
			.then(() => handler(req, res))
			.catch(() => res.destroy());
	});
	await once(server.listen(0, "127.0.0.1"), "listening");
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	if (typeof address !== "object" || !address) {
		throw new Error("Server has no address");
	}
	return `https://127.0.0.1:${address.port}`;
}

export type ReceivedRequest = Readonly<{
	method: string | undefined;
	url: string | undefined;
	headers: IncomingHttpHeaders;
	body: Buffer;
}>;

/** Like {@link serveHttps}, but records each request before `respond` answers it. */
export async function serveAndRecord(
	respond: (res: ServerResponse, req: ReceivedRequest) => void,
): Promise<{ origin: string; requests: ReceivedRequest[] }> {
	const requests: ReceivedRequest[] = [];
	const origin = await serveHttps(async (req, res) => {
		const received = {
			method: req.method,
			url: req.url,
			headers: req.headers,
			body: await readBody(req),
		};
		requests.push(received);
		respond(res, received);
	});
	return { origin, requests };
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: AsyncIterable<Buffer> = req;
	return Buffer.concat(await Array.fromAsync(chunks));
}
