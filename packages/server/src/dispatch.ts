import type { IncomingMessage, ServerResponse } from "node:http";

import { sniffImageFormat } from "@signal-stickers/core";

import { ApiError, toErrorResponse } from "./errors.ts";
import { createRouter } from "./router.ts";
import { createApiHandlers, type ApiContext } from "./routes.ts";

/** Answers one `/api/` request. `signal` aborts the work when the server stops. */
export type ApiRequestHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
	signal: AbortSignal,
) => Promise<void>;

/** Routes requests to the API handlers, aborting their work when the client disconnects. */
export function createApiRequestHandler(context: ApiContext): ApiRequestHandler {
	const route = createRouter(createApiHandlers(context));
	return async (req, res, path, signal) => {
		const disconnected = new AbortController();
		res.on("close", () => {
			if (!res.writableEnded) {
				disconnected.abort();
			}
		});
		try {
			const { handle, params } = route(req.method ?? "", path);
			const result = await handle({
				params,
				signal: AbortSignal.any([disconnected.signal, signal]),
				body: (maxBytes) => readBody(req, maxBytes),
			});
			if (result instanceof Uint8Array) {
				sendImage(res, result);
			} else {
				sendJson(res, 200, result);
			}
		} catch (error) {
			if (res.destroyed) {
				return;
			}
			const { status, body } = toErrorResponse(error);
			if (status >= 500) {
				context.log(`${req.method} ${path} failed: ${body.error}`);
			}
			sendJson(res, status, body);
		}
	};
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res
		.writeHead(status, {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		})
		.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
	const tooLarge = () => new ApiError(413, `The request is larger than ${maxBytes} bytes`);
	if (Number(req.headers["content-length"]) > maxBytes) {
		throw tooLarge();
	}
	const chunks: Buffer[] = [];
	let size = 0;
	const body: AsyncIterable<Buffer> = req;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > maxBytes) {
			throw tooLarge();
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function sendImage(res: ServerResponse, image: Uint8Array): void {
	const format = sniffImageFormat(image);
	res
		.writeHead(200, {
			"Content-Type": format ? `image/${format}` : "application/octet-stream",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		})
		.end(image);
}
