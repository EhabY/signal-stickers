import type { ServerEvent } from "@signal-stickers/server/api";
import { describe, expect, it, vi } from "vitest";

import { connectEvents, LiveProgress } from "../../src/lib/events.svelte.ts";

class FakeSocket extends EventTarget {
	closed = false;

	close(): void {
		this.closed = true;
	}

	receive(data: unknown): void {
		this.dispatchEvent(new MessageEvent("message", { data }));
	}

	drop(): void {
		this.dispatchEvent(new Event("close"));
	}
}

function connect() {
	const sockets: FakeSocket[] = [];
	const received: ServerEvent[] = [];
	const stop = connectEvents(
		(event) => {
			received.push(event);
		},
		{
			url: "ws://test/api/events",
			retryMs: 1000,
			createSocket: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
		},
	);
	return { sockets, received, stop };
}

describe("connectEvents", () => {
	it("delivers server events and ignores anything else", () => {
		const { sockets, received } = connect();

		sockets[0]!.receive(JSON.stringify({ type: "pull", progress: { done: 1, total: 2 } }));
		sockets[0]!.receive("not json");
		sockets[0]!.receive(JSON.stringify({ type: "other", progress: {} }));

		expect(received).toEqual([{ type: "pull", progress: { done: 1, total: 2 } }]);
	});

	it("reconnects after a drop until stopped", () => {
		vi.useFakeTimers();
		const { sockets, stop } = connect();

		sockets[0]!.drop();
		vi.advanceTimersByTime(1000);
		stop();
		sockets[1]!.drop();
		vi.advanceTimersByTime(1000);
		vi.useRealTimers();

		expect(sockets).toHaveLength(2);
		expect(sockets[1]!.closed).toBe(true);
	});
});

describe("LiveProgress", () => {
	it("keeps the latest progress of each operation", () => {
		const progress = new LiveProgress();

		progress.apply({ type: "push", progress: { done: 1, total: 4 } });
		progress.apply({ type: "push", progress: { done: 2, total: 4 } });
		progress.apply({ type: "link", progress: { step: "connecting" } });

		expect(progress.push).toEqual({ done: 2, total: 4 });
		expect(progress.link).toEqual({ step: "connecting" });
		expect(progress.pull).toBeUndefined();
	});
});
