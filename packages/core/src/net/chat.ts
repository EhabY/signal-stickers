import { getEnvironmentConfig, type Environment } from "../env.ts";
import { HttpError, request, type HttpMethod } from "./http.ts";
import { SIGNAL_CA } from "./signalCa.ts";

/** Basic auth for the chat service: `aci.deviceId` for a linked device, or the bare aci to link. */
export type ChatAuth = Readonly<{ username: string; password: string }>;

export type ChatClientOptions = Readonly<{ env: Environment; auth: ChatAuth; userAgent?: string }>;

export type ChatRequest = Readonly<{
	method: HttpMethod;
	/** Path on the chat service, starting with `/`. */
	path: string;
	/** Sent as JSON when present. */
	body?: unknown;
	signal?: AbortSignal | undefined;
}>;

export type ChatClient = Readonly<{
	/** Returns the parsed JSON response, or `undefined` when it is empty. */
	requestJson(request: ChatRequest): Promise<unknown>;
}>;

/** Signal refused the credentials, usually because the device was removed or unlinked. */
export class CredentialsRejectedError extends HttpError {
	override name = "CredentialsRejectedError";
}

/** How front ends and tests swap the chat service; {@link createChatClient} is the real one. */
export type ChatClientFactory = (options: ChatClientOptions) => ChatClient;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;

export function createChatClient({
	env,
	auth,
	userAgent = "signal-stickers",
}: ChatClientOptions): ChatClient {
	const { chatUrl } = getEnvironmentConfig(env);
	const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
	const headers = { Authorization: `Basic ${credentials}`, "User-Agent": userAgent };

	return {
		requestJson: async ({ method, path, body, signal }) => {
			const url = `${chatUrl}${path}`;
			const response = await request(url, {
				method,
				ca: SIGNAL_CA,
				headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				maxBytes: MAX_RESPONSE_BYTES,
				timeoutMs: TIMEOUT_MS,
				redactedUrl: url,
				signal,
			}).catch(rejectCredentials);
			return parseJson(response, `${method} ${url}`);
		},
	};
}

function rejectCredentials(error: unknown): never {
	if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
		throw new CredentialsRejectedError(
			"Signal rejected this device's credentials. It was probably removed from your phone or " +
				"unlinked after a long time unused: unlink it and link again.",
			{ status: error.status, cause: error },
		);
	}
	throw error;
}

function parseJson(bytes: Uint8Array, description: string): unknown {
	const text = Buffer.from(bytes).toString();
	if (text === "") {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new HttpError(`${description} returned invalid JSON`, { cause: error });
	}
}
