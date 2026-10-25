import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import TabHandoff from "../../src/components/TabHandoff.svelte";

function renderHandoff({ busy = false, saves = true } = {}) {
	const save = vi.fn<() => Promise<void>>(() =>
		saves ? Promise.resolve() : Promise.reject(new Error("offline")),
	);
	const reload = vi.fn<() => void>();
	const close = vi.spyOn(window, "close").mockImplementation(() => {});
	onTestFinished(() => {
		close.mockRestore();
	});
	render(TabHandoff, { busy, save, reload });
	return { save, reload, close };
}

/** Another editor tab, which sends `message` and hears the others. */
function otherTab(message: "opened" | "saved" = "opened") {
	const channel = new BroadcastChannel("signal-stickers-editor");
	const heard: unknown[] = [];
	channel.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
		heard.push(data);
	});
	onTestFinished(() => {
		channel.close();
	});
	// oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel has no target origin.
	channel.postMessage(message);
	return heard;
}

describe("TabHandoff", () => {
	it("saves and closes the tab when a newer one opens", async () => {
		const { save, close } = renderHandoff();

		otherTab();

		await waitFor(() => {
			expect(close).toHaveBeenCalledOnce();
		});
		expect(save).toHaveBeenCalledOnce();
	});

	it("tells the newer tab to load what it saved", async () => {
		renderHandoff();

		const heard = otherTab();

		await waitFor(() => {
			expect(heard).toEqual(["saved"]);
		});
	});

	it("reloads when an older tab saved", async () => {
		const { reload } = renderHandoff();

		otherTab("saved");

		await waitFor(() => {
			expect(reload).toHaveBeenCalledOnce();
		});
	});

	it("stays open while busy, saying where the editor is", async () => {
		const { close } = renderHandoff({ busy: true });

		otherTab();

		expect((await screen.findByRole("status")).textContent).toContain(
			"The editor is open in another tab",
		);
		expect(close).not.toHaveBeenCalled();
	});

	it("stays open when saving fails", async () => {
		const { close } = renderHandoff({ saves: false });

		otherTab();

		await screen.findByRole("status");
		expect(close).not.toHaveBeenCalled();
	});

	it("takes the editor back with Edit here", async () => {
		renderHandoff({ busy: true });
		const heard = otherTab();

		await fireEvent.click(await screen.findByRole("button", { name: "Edit here" }));

		await waitFor(() => {
			expect(heard).toEqual(["opened"]);
		});
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("does nothing in a browser without BroadcastChannel", () => {
		vi.stubGlobal("BroadcastChannel", null);
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});

		expect(() => renderHandoff()).not.toThrow();
	});
});
