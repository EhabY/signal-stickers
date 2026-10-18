import {
	createCdnClient,
	createChatClient,
	createCredentialsStore,
	credentialsWarning,
	getChatAuth,
	getLinkStatus,
	linkDevice,
	parsePackLink,
	pullPack,
	pushPack,
	STICKER_LIMITS,
	unlinkDevice,
	validatePackFolder,
	type CdnClient,
	type ChatClientFactory,
	type CredentialsStore,
	type Environment,
	type Pack,
} from "@signal-stickers/core";

import type {
	ApiRoute,
	ApiRoutes,
	PackResponse,
	PullRequest,
	ServerEvent,
	StatusResponse,
} from "./api.ts";
import { ApiError } from "./errors.ts";
import { createOperations, type Operations } from "./operations.ts";
import { routeParam, wholeNumberParam } from "./router.ts";
import type { WorkingCopy } from "./workingCopy.ts";

/** The engine the server drives; tests swap in fakes. */
export type ServerDeps = Readonly<{
	credentials: CredentialsStore;
	createChat: ChatClientFactory;
	createCdn: (env: Environment) => CdnClient;
	linkDevice: typeof linkDevice;
	unlinkDevice: typeof unlinkDevice;
	pullPack: typeof pullPack;
	pushPack: typeof pushPack;
	validatePackFolder: typeof validatePackFolder;
}>;

export type RouteRequest = Readonly<{
	/** Decoded path parameters, such as `file` for `:file`. */
	params: Readonly<Record<string, string>>;
	/** Aborts when the client disconnects or the server stops. */
	signal: AbortSignal;
	/** Reads the whole body, failing with 413 beyond `maxBytes`. */
	body(maxBytes: number): Promise<Uint8Array>;
}>;

/** Image routes answer with the image's bytes; the rest with JSON. */
export type RouteResult<R extends ApiRoute> = ApiRoutes[R]["response"] extends Blob
	? Uint8Array
	: ApiRoutes[R]["response"];

export type ApiHandlers = {
	readonly [R in ApiRoute]: (request: RouteRequest) => Promise<RouteResult<R>>;
};

export type ApiContext = Readonly<{
	env: Environment;
	deps: ServerDeps;
	workingCopy: WorkingCopy;
	broadcast(event: ServerEvent): void;
	/** Tells the user something, such as which file holds the credentials. */
	log(message: string): void;
}>;

/** Fills in the real core operations for any that `overrides` leaves out. */
export function withDefaultDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
	return {
		createChat: createChatClient,
		createCdn: (env) => createCdnClient({ env }),
		linkDevice,
		unlinkDevice,
		pullPack,
		pushPack,
		validatePackFolder,
		...overrides,
		credentials: overrides.credentials ?? createCredentialsStore(),
	};
}

export function createApiHandlers(context: ApiContext): ApiHandlers {
	const operations = createOperations();
	return {
		...accountHandlers(context, operations),
		"POST /api/pull": pullHandler(context, operations),
		...packHandlers(context, operations),
		"POST /api/push": pushHandler(context, operations),
	};
}

type Handlers<R extends ApiRoute> = Pick<ApiHandlers, R>;

function accountHandlers(
	{ env, deps, broadcast, log }: ApiContext,
	{ exclusive }: Operations,
): Handlers<"GET /api/status" | "POST /api/link" | "POST /api/unlink"> {
	const status = async (): Promise<StatusResponse> => ({
		env,
		link: getLinkStatus(await deps.credentials.load()),
		limits: STICKER_LIMITS,
	});
	return {
		"GET /api/status": status,
		"POST /api/link": ({ signal }) =>
			exclusive("link", async () => {
				if (await deps.credentials.load()) {
					throw new ApiError(400, "Already linked: unlink first");
				}
				const credentials = await deps.linkDevice({
					env,
					createChat: deps.createChat,
					signal,
					onProgress: (progress) => {
						broadcast({ type: "link", progress });
					},
				});
				await deps.credentials.save(credentials);
				log(`Linked. ${credentialsWarning(deps.credentials.path)}`);
				return status();
			}),
		"POST /api/unlink": ({ signal }) =>
			exclusive("unlink", async () => {
				const credentials = await deps.credentials.load();
				if (credentials) {
					await deps.unlinkDevice({ credentials, createChat: deps.createChat, signal });
					await deps.credentials.delete();
				}
				return status();
			}),
	};
}

function pullHandler(
	{ env, deps, workingCopy, broadcast }: ApiContext,
	{ exclusive }: Operations,
): ApiHandlers["POST /api/pull"] {
	return async (request) => {
		const locator = parsePackLink(parsePullRequest(await readJson(request)).link);
		return exclusive("pull", async () => {
			const pack = await workingCopy.replace((dir) =>
				deps.pullPack({
					locator,
					dir,
					cdn: deps.createCdn(env),
					signal: request.signal,
					onProgress: (progress) => {
						broadcast({ type: "pull", progress });
					},
				}),
			);
			return packResponse(pack, { deps, workingCopy });
		});
	};
}

const MAX_JSON_BYTES = 1024 * 1024;

async function readJson(request: RouteRequest): Promise<unknown> {
	const text = Buffer.from(await request.body(MAX_JSON_BYTES)).toString();
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new ApiError(400, "The request body is not valid JSON", { cause: error });
	}
}

function parsePullRequest(value: unknown): PullRequest {
	if (
		typeof value !== "object" ||
		value === null ||
		!("link" in value) ||
		typeof value.link !== "string"
	) {
		throw new ApiError(400, "Send the pack link as { link }");
	}
	return { link: value.link };
}

async function packResponse(
	pack: Pack,
	{ deps, workingCopy }: Pick<ApiContext, "deps" | "workingCopy">,
): Promise<PackResponse> {
	return { pack, issues: await deps.validatePackFolder(workingCopy.dir) };
}

function packHandlers(
	context: ApiContext,
	{ assertEditable }: Operations,
): Handlers<
	| "GET /api/pack"
	| "PUT /api/pack"
	| "GET /api/pack/sticker/:file"
	| "POST /api/pack/sticker"
	| "DELETE /api/pack/sticker/:index/:file"
	| "PUT /api/pack/cover"
> {
	const { workingCopy } = context;
	return {
		"GET /api/pack": async () => packResponse(await workingCopy.read(), context),
		"PUT /api/pack": async (request) => {
			const value = await readJson(request);
			assertEditable();
			return packResponse(await workingCopy.update(value), context);
		},
		"GET /api/pack/sticker/:file": (request) => workingCopy.readImage(routeParam(request, "file")),
		"POST /api/pack/sticker": async (request) => {
			const image = await request.body(STICKER_LIMITS.maxBytes);
			assertEditable();
			const { pack, file } = await workingCopy.addSticker(image);
			return { ...(await packResponse(pack, context)), file };
		},
		"DELETE /api/pack/sticker/:index/:file": async (request) => {
			const index = wholeNumberParam(request, "index");
			assertEditable();
			const pack = await workingCopy.removeSticker(index, routeParam(request, "file"));
			return packResponse(pack, context);
		},
		"PUT /api/pack/cover": async (request) => {
			const image = await request.body(STICKER_LIMITS.maxBytes);
			assertEditable();
			return packResponse(await workingCopy.setCover(image), context);
		},
	};
}

function pushHandler(
	{ env, deps, workingCopy, broadcast }: ApiContext,
	{ exclusive }: Operations,
): ApiHandlers["POST /api/push"] {
	return ({ signal }) =>
		exclusive("push", async () => {
			const credentials = await deps.credentials.load();
			if (!credentials) {
				throw new ApiError(400, "Link a device before uploading");
			}
			if (credentials.env !== env) {
				throw new ApiError(
					400,
					`This device is linked on Signal ${credentials.env}, but the server uses ${env}`,
				);
			}
			return workingCopy.whileLocked(async () => {
				await workingCopy.read();
				const { link } = await deps.pushPack({
					dir: workingCopy.dir,
					chat: deps.createChat({ env, auth: getChatAuth(credentials) }),
					cdn: deps.createCdn(env),
					signal,
					onProgress: (progress) => {
						broadcast({ type: "push", progress });
					},
				});
				return { link };
			});
		});
}
