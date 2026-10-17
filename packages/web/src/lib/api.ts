import type {
	AddStickerResponse,
	ApiRoute,
	ApiRoutes,
	PackResponse,
	PushResponse,
	ServerEvent,
	StatusResponse,
} from "@signal-stickers/server/api";

// Core's types, reached through the server's API so web depends only on that contract.
export type Pack = PackResponse["pack"];
export type PackSticker = Pack["stickers"][number];
export type ValidationIssue = PackResponse["issues"][number];
export type StickerLimits = StatusResponse["limits"];
export type Environment = StatusResponse["env"];
export type EventProgress<T extends ServerEvent["type"]> = Extract<
	ServerEvent,
	{ type: T }
>["progress"];
export type LinkProgress = EventProgress<"link">;

/** The local server's REST API. Every call rejects with an {@link ApiError} on failure. */
export type Api = Readonly<{
	getStatus(): Promise<StatusResponse>;
	/** Resolves once the phone has scanned the QR code; aborting cancels linking. */
	link(signal?: AbortSignal): Promise<StatusResponse>;
	unlink(): Promise<StatusResponse>;
	pull(link: string): Promise<PackResponse>;
	/** Resolves `undefined` when there is no working copy yet. */
	getPack(): Promise<PackResponse | undefined>;
	savePack(pack: Pack): Promise<PackResponse>;
	addSticker(image: Blob): Promise<AddStickerResponse>;
	removeSticker(file: string): Promise<PackResponse>;
	setCover(image: Blob): Promise<PackResponse>;
	push(): Promise<PushResponse>;
	/** The URL of a working-copy image; a new `version` makes the browser fetch it again. */
	stickerUrl(file: string, version: number): string;
}>;

/** A failed call, with the server's message and, for a refused push, what is wrong. */
export class ApiError extends Error {
	override name = "ApiError";
	readonly status: number;
	readonly issues: readonly ValidationIssue[];

	constructor(status: number, message: string, issues: readonly ValidationIssue[] = []) {
		super(message);
		this.status = status;
		this.issues = issues;
	}
}

type CallOptions = Readonly<{ file?: string; body?: unknown; signal?: AbortSignal | undefined }>;

export function createApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): Api {
	function call<R extends JsonRoute>(
		route: R,
		options: CallOptions = {},
	): Promise<ApiRoutes[R]["response"]> {
		return callApi(fetchFn, route, options);
	}

	return {
		getStatus: () => call("GET /api/status"),
		link: (signal) => call("POST /api/link", { signal }),
		unlink: () => call("POST /api/unlink"),
		pull: (link) => call("POST /api/pull", { body: { link } }),
		getPack: () => call("GET /api/pack").catch(ignoreNotFound),
		savePack: (pack) => call("PUT /api/pack", { body: pack }),
		addSticker: (image) => call("POST /api/pack/sticker", { body: image }),
		removeSticker: (file) => call("DELETE /api/pack/sticker/:file", { file }),
		setCover: (image) => call("PUT /api/pack/cover", { body: image }),
		push: () => call("POST /api/push"),
		stickerUrl: (file, version) => `${routePath("/api/pack/sticker/:file", file)}?v=${version}`,
	};
}

/** The message to show for anything a call or a conversion threw. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JsonRoute = Exclude<ApiRoute, "GET /api/pack/sticker/:file">;

async function callApi<R extends JsonRoute>(
	fetchFn: typeof fetch,
	route: R,
	{ file, body, signal }: CallOptions,
): Promise<ApiRoutes[R]["response"]> {
	const [method = "GET", template = ""] = route.split(" ");
	const init: RequestInit = { method, signal: signal ?? null };
	if (body instanceof Blob) {
		init.body = body;
		init.headers = { "Content-Type": body.type };
	} else if (body !== undefined) {
		init.body = JSON.stringify(body);
		init.headers = { "Content-Type": "application/json" };
	}
	const response = await fetchFn(routePath(template, file), init);
	if (!response.ok) {
		throw await readError(response);
	}
	const result: unknown = await response.json();
	const isResponse: (value: unknown) => value is ApiRoutes[R]["response"] = RESPONSE_GUARDS[route];
	if (!isResponse(result)) {
		throw new ApiError(response.status, `Unexpected response to ${route}`);
	}
	return result;
}

function routePath(template: string, file?: string): string {
	return file === undefined ? template : template.replace(":file", encodeURIComponent(file));
}

async function readError(response: Response): Promise<ApiError> {
	const body: unknown = await response.json().catch(() => null);
	if (!isRecord(body) || typeof body.error !== "string") {
		return new ApiError(response.status, `The server responded ${response.status}`);
	}
	const issues = Array.isArray(body.issues) ? body.issues.filter(isValidationIssue) : [];
	return new ApiError(response.status, body.error, issues);
}

function isValidationIssue(value: unknown): value is ValidationIssue {
	return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

const RESPONSE_GUARDS: {
	[R in JsonRoute]: (value: unknown) => value is ApiRoutes[R]["response"];
} = {
	"GET /api/status": isStatusResponse,
	"POST /api/link": isStatusResponse,
	"POST /api/unlink": isStatusResponse,
	"POST /api/pull": isPackResponse,
	"GET /api/pack": isPackResponse,
	"PUT /api/pack": isPackResponse,
	"POST /api/pack/sticker": isAddStickerResponse,
	"DELETE /api/pack/sticker/:file": isPackResponse,
	"PUT /api/pack/cover": isPackResponse,
	"POST /api/push": isPushResponse,
};

function isStatusResponse(value: unknown): value is StatusResponse {
	return (
		isRecord(value) &&
		typeof value.env === "string" &&
		isRecord(value.link) &&
		typeof value.link.linked === "boolean" &&
		isRecord(value.limits)
	);
}

function isPackResponse(value: unknown): value is PackResponse {
	return (
		isRecord(value) &&
		isPack(value.pack) &&
		Array.isArray(value.issues) &&
		value.issues.every(isValidationIssue)
	);
}

function isPack(value: unknown): value is Pack {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		typeof value.author === "string" &&
		typeof value.cover === "string" &&
		Array.isArray(value.stickers) &&
		value.stickers.every((sticker) => isRecord(sticker) && typeof sticker.file === "string")
	);
}

function isAddStickerResponse(value: unknown): value is AddStickerResponse {
	return isRecord(value) && typeof value.file === "string" && isPackResponse(value);
}

function isPushResponse(value: unknown): value is PushResponse {
	return isRecord(value) && typeof value.link === "string";
}

function ignoreNotFound(error: unknown): undefined {
	if (error instanceof ApiError && error.status === 404) {
		return undefined;
	}
	throw error;
}
