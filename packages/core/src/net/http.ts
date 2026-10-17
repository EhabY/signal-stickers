import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export class HttpError extends Error {
	override name = "HttpError";
	readonly status: number | undefined;

	constructor(message: string, options: ErrorOptions & { status?: number | undefined } = {}) {
		super(message, options);
		this.status = options.status;
	}
}

export type HttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export type RequestOptions = Readonly<{
	method: HttpMethod;
	/** Trusted CA in PEM form; replaces the default root store. */
	ca: string;
	headers: Readonly<Record<string, string>>;
	body?: Uint8Array | string | undefined;
	/** Largest response body accepted. */
	maxBytes: number;
	timeoutMs: number;
	/** Used in error messages so secrets in the URL are never surfaced. */
	redactedUrl: string;
	signal?: AbortSignal | undefined;
}>;

export type GetBytesOptions = Omit<RequestOptions, "method" | "body">;

/**
 * Sends a request and returns the body of its 2xx response. Rejects with the caller's abort reason
 * when `signal` aborts, and with an {@link HttpError} for anything else, including timeouts.
 */
export async function request(url: string, options: RequestOptions): Promise<Uint8Array> {
	const { method, redactedUrl, timeoutMs, signal } = options;
	const timeout = AbortSignal.timeout(timeoutMs);
	try {
		return await exchange(url, options, signal ? AbortSignal.any([signal, timeout]) : timeout);
	} catch (error) {
		signal?.throwIfAborted();
		if (error instanceof HttpError) {
			throw error;
		}
		const reason = timeout.aborted
			? `timed out after ${timeoutMs}ms`
			: `failed: ${describeError(error)}`;
		throw new HttpError(`${method} ${redactedUrl} ${reason}`, { cause: error });
	}
}

export function getBytes(url: string, options: GetBytesOptions): Promise<Uint8Array> {
	return request(url, { ...options, method: "GET" });
}

async function exchange(
	url: string,
	{ method, ca, headers, body, maxBytes, redactedUrl }: RequestOptions,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const sentHeaders =
		body === undefined
			? headers
			: { ...headers, "Content-Length": String(Buffer.byteLength(body)) };
	const response = await send(url, { method, ca, headers: sentHeaders, signal }, body);
	const status = response.statusCode ?? 0;
	if (status < 200 || status > 299) {
		response.resume();
		throw new HttpError(`${method} ${redactedUrl} failed with status ${status}`, { status });
	}
	const tooLarge = () => new HttpError(`${method} ${redactedUrl} exceeded ${maxBytes} bytes`);
	if (Number(response.headers["content-length"]) > maxBytes) {
		response.destroy();
		throw tooLarge();
	}
	const chunks: AsyncIterable<Buffer> = response;
	const received: Buffer[] = [];
	let size = 0;
	for await (const chunk of chunks) {
		size += chunk.length;
		if (size > maxBytes) {
			response.destroy();
			throw tooLarge();
		}
		received.push(chunk);
	}
	return Buffer.concat(received);
}

/** Node reports a failed connection to every address of a host as an AggregateError with no message. */
function describeError(error: unknown): string {
	if (error instanceof AggregateError) {
		return error.errors.map(describeError).join("; ");
	}
	if (error instanceof Error) {
		return error.message === "" && "code" in error ? String(error.code) : error.message;
	}
	return String(error);
}

function send(
	url: string,
	options: Readonly<{
		method: HttpMethod;
		ca: string;
		headers: Readonly<Record<string, string>>;
		signal: AbortSignal;
	}>,
	body: Uint8Array | string | undefined,
): Promise<IncomingMessage> {
	const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
	httpsRequest(url, options).on("response", resolve).on("error", reject).end(body);
	return promise;
}
