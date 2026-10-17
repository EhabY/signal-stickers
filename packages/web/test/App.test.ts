import type { PackResponse, ServerEvent } from "@signal-stickers/server/api";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import App from "../src/App.svelte";
import { ApiError } from "../src/lib/api.ts";
import { encodeWithinLimit, type StickerEncoder } from "../src/lib/stickerImage.ts";
import {
	CATS,
	fakeApi,
	LIMITS,
	LINKED,
	linkUntilAborted,
	packResponse,
	QR_URL,
} from "./support/api.ts";

const LINK = "https://signal.art/addstickers/#pack_id=abc&pack_key=def";

function renderApp(
	api = fakeApi(),
	encode: StickerEncoder = vi.fn<StickerEncoder>((image) => Promise.resolve(image)),
) {
	const events: { send?: (event: ServerEvent) => void } = {};
	render(App, {
		api,
		encode,
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

	it("shows the cover the server picks when the cover sticker is removed", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse({ ...CATS, cover: "002.png" }));
		api.removeSticker.mockResolvedValue(
			packResponse({ ...CATS, stickers: CATS.stickers.toSpliced(1, 1) }),
		);
		renderApp(api);

		await fireEvent.click(await screen.findByRole("button", { name: "Remove sticker 2" }));

		await vi.waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Use sticker 1 as the cover" })
					.getAttribute("aria-pressed"),
			).toBe("true");
		});
		expect(api.removeSticker).toHaveBeenCalledWith(1, "002.png");
	});

	it("moves focus to the new last sticker after removing the last one", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		api.removeSticker.mockResolvedValue(
			packResponse({ ...CATS, stickers: CATS.stickers.slice(0, 2) }),
		);
		renderApp(api);
		const remove = await screen.findByRole("button", { name: "Remove sticker 3" });
		remove.focus();

		await fireEvent.click(remove);

		await vi.waitFor(() => {
			expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove sticker 2");
		});
	});

	it("moves focus to Add images after removing the only sticker", async () => {
		const api = fakeApi();
		const onlySticker = { ...CATS, stickers: CATS.stickers.slice(0, 1) };
		api.getPack.mockResolvedValue(packResponse(onlySticker));
		api.removeSticker.mockResolvedValue(packResponse({ ...onlySticker, stickers: [] }));
		renderApp(api);
		const remove = await screen.findByRole("button", { name: "Remove sticker 1" });
		remove.focus();

		await fireEvent.click(remove);

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Add images"));
		});
	});

	it("keeps focus on the cover controls after switching back to a sticker cover", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse({ ...CATS, cover: "cover.webp" }));
		renderApp(api);

		await fireEvent.click(await screen.findByRole("button", { name: "Use a sticker instead" }));

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Upload a separate cover"));
		});
	});

	it("explains when the browser cannot convert an added image to WebP", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		// Like Safari, whose canvas encodes PNG when asked for WebP.
		const png = new Blob([new Uint8Array(LIMITS.maxBytes + 1)], { type: "image/png" });
		renderApp(api, (_, limits) => encodeWithinLimit(() => Promise.resolve(png), limits));
		const photo = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: [photo] },
		});

		expect((await screen.findByRole("alert")).textContent).toContain(
			"photo.jpg: This browser cannot convert images to WebP",
		);
		expect(api.addSticker).not.toHaveBeenCalled();
	});

	it("keeps a running publish and its link when switching views", async () => {
		const api = fakeApi();
		api.getStatus.mockResolvedValue(LINKED);
		api.getPack.mockResolvedValue(packResponse());
		const pushed = Promise.withResolvers<{ link: string }>();
		api.push.mockReturnValue(pushed.promise);
		renderApp(api);

		await fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
		await fireEvent.click(screen.getByRole("button", { name: "Publish to Signal production" }));
		await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		pushed.resolve({ link: LINK });
		await fireEvent.click(screen.getByRole("button", { name: "Publish" }));

		expect((await screen.findByRole("link")).getAttribute("href")).toBe(LINK);
		expect(api.push).toHaveBeenCalledOnce();
	});

	it("keeps the QR code and Cancel when switching views while linking", async () => {
		const api = fakeApi();
		api.link.mockImplementation(linkUntilAborted);
		const { events } = renderApp(api);

		await fireEvent.click(await screen.findByRole("button", { name: "Account" }));
		await fireEvent.click(screen.getByRole("button", { name: "Link to Signal production" }));
		events.send?.({ type: "link", progress: { step: "waitingForScan", qrUrl: QR_URL } });
		await fireEvent.click(screen.getByRole("button", { name: "Import" }));
		await fireEvent.click(screen.getByRole("button", { name: "Account" }));

		expect(await screen.findByRole("img", { name: "QR code to link this device" })).toBeTruthy();
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(api.link.mock.calls[0]?.[0]?.aborted).toBe(true);
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
