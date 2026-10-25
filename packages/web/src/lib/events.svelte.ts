import type { EventsPath, ServerEvent } from "@signal-stickers/server/api";

import { isRecord, type EventProgress } from "./api.ts";

/** The latest progress the server reported per operation; clear one before starting it. */
export class LiveProgress {
	link: EventProgress<"link"> | undefined = $state.raw();
	pull: EventProgress<"pull"> | undefined = $state.raw();
	push: EventProgress<"push"> | undefined = $state.raw();

	apply(event: ServerEvent): void {
		switch (event.type) {
			case "link":
				this.link = event.progress;
				break;
			case "pull":
				this.pull = event.progress;
				break;
			case "push":
				this.push = event.progress;
				break;
		}
	}
}

export type EventSocket = Pick<WebSocket, "addEventListener" | "close">;

export type EventsOptions = Readonly<{
	url?: string;
	createSocket?: (url: string) => EventSocket;
	retryMs?: number;
}>;

export type EventHandlers = Readonly<{
	onEvent: (event: ServerEvent) => void;
	/** Runs each time the connection opens or drops, as when the server stops. */
	onConnection: (connected: boolean) => void;
}>;

export type ConnectEvents = (handlers: EventHandlers, options?: EventsOptions) => () => void;

/**
 * Listens to the server's events until the returned function runs. After a drop it reconnects,
 * waiting twice as long after each failure up to {@link MAX_RETRY_MS}, or at once when the tab shows,
 * since background tabs run timers late.
 */
export const connectEvents: ConnectEvents = (
	{ onEvent, onConnection },
	{
		url = eventsUrl(),
		createSocket = (target: string) => new WebSocket(target),
		retryMs = 1000,
	} = {},
) => {
	let socket: EventSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let delay = retryMs;
	const stopping = new AbortController();

	function open(): void {
		retry = undefined;
		socket = createSocket(url);
		socket.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
			const event = parseEvent(data);
			if (event) {
				onEvent(event);
			}
		});
		socket.addEventListener("open", () => {
			delay = retryMs;
			onConnection(true);
		});
		socket.addEventListener("close", () => {
			if (!stopping.signal.aborted) {
				onConnection(false);
				retry = setTimeout(open, delay);
				delay = Math.min(delay * 2, MAX_RETRY_MS);
			}
		});
	}

	function retryNow(): void {
		if (retry !== undefined && document.visibilityState === "visible") {
			clearTimeout(retry);
			open();
		}
	}

	document.addEventListener("visibilitychange", retryNow, { signal: stopping.signal });
	open();
	return () => {
		stopping.abort();
		clearTimeout(retry);
		socket?.close();
	};
};

const MAX_RETRY_MS = 10_000;

function eventsUrl(): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const path: EventsPath = "/api/events";
	return `${protocol}//${location.host}${path}`;
}

function parseEvent(data: unknown): ServerEvent | undefined {
	if (typeof data !== "string") {
		return undefined;
	}
	try {
		const value: unknown = JSON.parse(data);
		return isServerEvent(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function isServerEvent(value: unknown): value is ServerEvent {
	return (
		isRecord(value) &&
		(value.type === "link" || value.type === "pull" || value.type === "push") &&
		isRecord(value.progress)
	);
}
