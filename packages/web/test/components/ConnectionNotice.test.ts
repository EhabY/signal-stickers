import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import ConnectionNotice from "../../src/components/ConnectionNotice.svelte";

function renderNotice(connected: boolean) {
	vi.useFakeTimers();
	onTestFinished(() => {
		vi.useRealTimers();
	});
	return render(ConnectionNotice, { connected, delayMs: 2000 });
}

describe("ConnectionNotice", () => {
	it("says the app stopped once the connection stays down", async () => {
		renderNotice(false);

		await vi.advanceTimersByTimeAsync(2000);

		expect(screen.getByRole("alert").textContent).toContain("Signal Stickers has stopped");
	});

	it("shows nothing when the connection comes back in time", async () => {
		const { rerender } = renderNotice(false);

		await vi.advanceTimersByTimeAsync(1000);
		await rerender({ connected: true });
		await vi.advanceTimersByTimeAsync(2000);

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("hides once connected again", async () => {
		const { rerender } = renderNotice(false);
		await vi.advanceTimersByTimeAsync(2000);

		await rerender({ connected: true });

		expect(screen.queryByRole("alert")).toBeNull();
	});
});
