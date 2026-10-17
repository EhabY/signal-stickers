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

export type ConnectEvents = (
	onEvent: (event: ServerEvent) => void,
	options?: EventsOptions,
) => () => void;

/** Listens to the server's events, reconnecting after a drop until the returned function runs. */
export const connectEvents: ConnectEvents = (
	onEvent,
	{
		url = eventsUrl(),
		createSocket = (target: string) => new WebSocket(target),
		retryMs = 1000,
	} = {},
) => {
	let socket: EventSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	function open(): void {
		socket = createSocket(url);
		socket.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
			const event = parseEvent(data);
			if (event) {
				onEvent(event);
			}
		});
		socket.addEventListener("close", () => {
			if (!stopped) {
				retry = setTimeout(open, retryMs);
			}
		});
	}

	open();
	return () => {
		stopped = true;
		clearTimeout(retry);
		socket?.close();
	};
};

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
