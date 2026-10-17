import type { IncomingMessage } from "node:http";
import { request } from "node:https";

export class HttpError extends Error {
	override name = "HttpError";
	readonly status: number | undefined;

	constructor(message: string, options: ErrorOptions & { status?: number | undefined } = {}) {
		super(message, options);
		this.status = options.status;
	}
}

export type GetBytesOptions = Readonly<{
	/** Trusted CA in PEM form; replaces the default root store. */
	ca: string;
	headers: Readonly<Record<string, string>>;
	maxBytes: number;
	timeoutMs: number;
	/** Used in error messages so secrets in the URL are never surfaced. */
	redactedUrl: string;
	signal?: AbortSignal | undefined;
}>;

/**
 * GETs `url` and returns the body. Rejects with the caller's abort reason when `signal` aborts, and
 * with an {@link HttpError} for anything else, including timeouts.
 */
export async function getBytes(url: string, options: GetBytesOptions): Promise<Uint8Array> {
	const { redactedUrl, timeoutMs, signal } = options;
	const timeout = AbortSignal.timeout(timeoutMs);
	try {
		return await download(url, options, signal ? AbortSignal.any([signal, timeout]) : timeout);
	} catch (error) {
		signal?.throwIfAborted();
		if (error instanceof HttpError) {
			throw error;
		}
		const reason = timeout.aborted
			? `timed out after ${timeoutMs}ms`
			: `failed: ${describeError(error)}`;
		throw new HttpError(`GET ${redactedUrl} ${reason}`, { cause: error });
	}
}

async function download(
	url: string,
	{ ca, headers, maxBytes, redactedUrl }: GetBytesOptions,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const response = await send(url, { ca, headers, signal });
	if (response.statusCode !== 200) {
		response.resume();
		throw new HttpError(`GET ${redactedUrl} failed with status ${response.statusCode}`, {
			status: response.statusCode,
		});
	}
	const tooLarge = () => new HttpError(`GET ${redactedUrl} exceeded ${maxBytes} bytes`);
	if (Number(response.headers["content-length"]) > maxBytes) {
		response.destroy();
		throw tooLarge();
	}
	const body: AsyncIterable<Buffer> = response;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > maxBytes) {
			response.destroy();
			throw tooLarge();
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
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
	options: Readonly<{ ca: string; headers: Readonly<Record<string, string>>; signal: AbortSignal }>,
): Promise<IncomingMessage> {
	const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
	request(url, options).on("response", resolve).on("error", reject).end();
	return promise;
}
