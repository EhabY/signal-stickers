import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import type { Environment } from "@signal-stickers/core";
import { WebSocket, WebSocketServer } from "ws";

import type { EventsPath, ServerEvent } from "./api.ts";
import { createApiRequestHandler, sendJson, type ApiRequestHandler } from "./dispatch.ts";
import { withDefaultDeps, type ServerDeps } from "./routes.ts";
import { serveStatic } from "./static.ts";
import { createWorkingCopy } from "./workingCopy.ts";

/** The server only ever listens on loopback; it has no other authentication. */
export const HOST = "127.0.0.1";

export type ServerOptions = Readonly<{
	env: Environment;
	/** The working copy: one pack folder, which each pull replaces. */
	packDir: string;
	/** The built web UI. Without it, only the API is served. */
	webDir?: string | undefined;
	/** Defaults to a random free port. */
	port?: number | undefined;
	/** Origins besides the server's own that may call the API, such as the web dev server. */
	allowedOrigins?: readonly string[] | undefined;
	/** Defaults to the real core operations and credentials store. */
	deps?: Partial<ServerDeps> | undefined;
	/** Messages for the user, such as which file holds the credentials. */
	log?: ((message: string) => void) | undefined;
	/** Runs once no browser tab has been connected for `idleMs`, after the first one connected. */
	onIdle?: (() => void) | undefined;
	idleMs?: number | undefined;
}>;

export type RunningServer = Readonly<{
	url: string;
	/** Aborts running operations and closes every connection. */
	close(): Promise<void>;
}>;

/** Serves the API, the events WebSocket, and the web UI on {@link HOST}. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
	const { env, packDir, webDir, port = 0, allowedOrigins = [], log = () => {} } = options;
	const stopping = new AbortController();
	const events = new WebSocketServer({ noServer: true });
	watchIdle(events, options);
	const handleApi = createApiRequestHandler({
		env,
		deps: withDefaultDeps(options.deps),
		workingCopy: createWorkingCopy(packDir),
		broadcast: (event) => {
			broadcast(events, event);
		},
		log,
	});

	const server = createServer();
	server.listen(port, HOST);
	await once(server, "listening");
	const url = `http://${HOST}:${listeningPort(server)}`;
	const site: Site = {
		url,
		trusted: trustedPeers(url, allowedOrigins),
		handleApi,
		events,
		webDir,
		signal: stopping.signal,
	};
	server.on("request", (req, res) => {
		handleRequest(req, res, site);
	});
	server.on("upgrade", (req, socket, head) => {
		handleUpgrade(req, socket, head, site);
	});

	return {
		url,
		close: async () => {
			stopping.abort();
			await closeServer(server, events);
		},
	};
}

/** Each browser tab holds an events connection, so none left means the user closed the editor. */
function watchIdle(events: WebSocketServer, { onIdle, idleMs = 10_000 }: ServerOptions): void {
	if (!onIdle) {
		return;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	events.on("connection", (client: WebSocket) => {
		clearTimeout(timer);
		client.on("close", () => {
			if (events.clients.size === 0) {
				// Closing the server closes every connection too, and must not wait for this.
				timer = setTimeout(onIdle, idleMs).unref();
			}
		});
	});
}

function broadcast(events: WebSocketServer, event: ServerEvent): void {
	const message = JSON.stringify(event);
	for (const client of events.clients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

function listeningPort(server: Server): number {
	const address = server.address();
	if (typeof address !== "object" || !address) {
		throw new Error("The server is not listening on a port");
	}
	return address.port;
}

type Site = Readonly<{
	url: string;
	trusted: TrustedPeers;
	handleApi: ApiRequestHandler;
	events: WebSocketServer;
	webDir: string | undefined;
	/** Aborts when the server stops. */
	signal: AbortSignal;
}>;

type TrustedPeers = Readonly<{ hosts: ReadonlySet<string>; origins: ReadonlySet<string> }>;

function trustedPeers(url: string, allowedOrigins: readonly string[]): TrustedPeers {
	const { port } = new URL(url);
	const hosts = [`${HOST}:${port}`, `localhost:${port}`];
	return {
		hosts: new Set(hosts),
		origins: new Set([...hosts.map((host) => `http://${host}`), ...allowedOrigins]),
	};
}

/** A framed page sends its own Origin, so only this stops another site tricking clicks on it. */
const NO_FRAMING = {
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
};

function handleRequest(req: IncomingMessage, res: ServerResponse, site: Site): void {
	res.setHeaders(new Map(Object.entries(NO_FRAMING)));
	const rejection = rejectUntrusted(req, site.trusted);
	const path = requestPath(req, site);
	if (rejection !== undefined) {
		sendJson(res, 403, { error: rejection });
	} else if (path === undefined) {
		sendJson(res, 400, { error: "Invalid request URL" });
	} else if (path.startsWith("/api/")) {
		void site.handleApi(req, res, path, site.signal);
	} else if (site.webDir !== undefined && req.method === "GET") {
		void serveStatic(site.webDir, path, res);
	} else {
		sendJson(res, 404, { error: "Not found" });
	}
}

/**
 * Any web page can send requests to loopback: a foreign `Host` means DNS rebinding, and a foreign
 * `Origin` means another site's page. Clients that are not browsers send no `Origin`.
 */
function rejectUntrusted({ headers }: IncomingMessage, trusted: TrustedPeers): string | undefined {
	if (!trusted.hosts.has(headers.host?.toLowerCase() ?? "")) {
		return "Unexpected Host header";
	}
	if (headers.origin !== undefined && !trusted.origins.has(headers.origin)) {
		return "Requests from other sites are not allowed";
	}
	return undefined;
}

/** The path of the request's URL, or undefined when it is not a valid URL. */
function requestPath(req: IncomingMessage, site: Site): string | undefined {
	return URL.parse(req.url ?? "/", site.url)?.pathname;
}

const EVENTS_PATH: EventsPath = "/api/events";

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, site: Site): void {
	const rejection = rejectUntrusted(req, site.trusted);
	const path = requestPath(req, site);
	if (rejection !== undefined) {
		socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
	} else if (path === undefined) {
		socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
	} else if (path === EVENTS_PATH) {
		site.events.handleUpgrade(req, socket, head, (client) => {
			client.on("error", () => {
				client.terminate();
			});
			site.events.emit("connection", client, req);
		});
	} else {
		socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
	}
}

async function closeServer(server: Server, events: WebSocketServer): Promise<void> {
	for (const client of events.clients) {
		client.terminate();
	}
	const closed = once(server, "close");
	server.close();
	server.closeAllConnections();
	await closed;
}
