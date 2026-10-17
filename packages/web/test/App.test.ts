import type { PackResponse, ServerEvent } from "@signal-stickers/server/api";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import App from "../src/App.svelte";
import { ApiError } from "../src/lib/api.ts";
import type { StickerEncoder } from "../src/lib/stickerImage.ts";
import { fakeApi, packResponse } from "./support/api.ts";

const LINK = "https://signal.art/addstickers/#pack_id=abc&pack_key=def";

function renderApp(api = fakeApi()) {
	const events: { send?: (event: ServerEvent) => void } = {};
	render(App, {
		api,
		encode: vi.fn<StickerEncoder>((image) => Promise.resolve(image)),
		connect: (onEvent: (event: ServerEvent) => void) => {
			events.send = onEvent;
			return vi.fn<() => void>();
		},
	});
	return { api, events };
}

describe("App", () => {
	it("opens the editor on the server's working copy", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());

		renderApp(api);

		const title = await screen.findByRole("textbox", { name: "Title" });
		expect(title).toHaveProperty("value", "Cats");
		expect(screen.getByText("Signal production")).toBeTruthy();
	});

	it("imports a pack from its link, showing the download progress", async () => {
		const api = fakeApi();
		const pulled = Promise.withResolvers<PackResponse>();
		api.pull.mockReturnValue(pulled.promise);
		const { events } = renderApp(api);

		await fireEvent.input(await screen.findByLabelText("Sticker pack link"), {
			target: { value: LINK },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Import pack" }));
		events.send?.({ type: "pull", progress: { done: 1, total: 3 } });

		expect(await screen.findByText("Downloaded: 1 of 3")).toBeTruthy();
		pulled.resolve(packResponse());
		expect(await screen.findByRole("heading", { name: "Edit pack" })).toBeTruthy();
		expect(api.pull).toHaveBeenCalledWith(LINK);
	});

	it("offers to import over a pack folder it cannot open", async () => {
		const api = fakeApi();
		api.getPack.mockRejectedValue(new ApiError(400, "cover must be a file name in the pack"));
		renderApp(api);

		expect((await screen.findByRole("alert")).textContent).toBe(
			"Could not open the pack folder: cover must be a file name in the pack. Import a pack to replace it.",
		);
		await fireEvent.input(screen.getByLabelText("Sticker pack link"), { target: { value: LINK } });
		await fireEvent.click(screen.getByRole("button", { name: "Import pack" }));

		expect(await screen.findByRole("heading", { name: "Edit pack" })).toBeTruthy();
		expect(screen.queryByText(/Could not open the pack folder/u)).toBeNull();
	});

	it("says when the server cannot be reached", async () => {
		const api = fakeApi();
		api.getStatus.mockRejectedValue(new Error("Failed to fetch"));

		renderApp(api);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Could not reach the signal-stickers server: Failed to fetch",
		);
	});
});
