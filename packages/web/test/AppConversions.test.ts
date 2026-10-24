import { fireEvent, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { encodeWithinLimit } from "../src/lib/stickerImage.ts";
import { encodeUntilAborted } from "./support/animation.ts";
import { fakeApi, LIMITS, packResponse } from "./support/api.ts";
import { renderApp } from "./support/app.ts";

describe("App while images convert", () => {
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

	it("shows how far converting an added animation has got, then what it made", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		const converted = Promise.withResolvers<Blob>();
		const encoding = { size: 320, colors: 256, frames: 90, fps: 29.97 };
		renderApp(api, async (_, __, options) => {
			options?.onProgress?.({ step: "encode", ...encoding });
			const apng = await converted.promise;
			options?.onAnimated?.(encoding);
			return apng;
		});
		const animation = new File(["gif"], "cat.gif", { type: "image/gif" });

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: [animation] },
		});
		const progress = (await screen.findByRole("status")).textContent;
		converted.resolve(new Blob([new Uint8Array(284 * 1024)], { type: "image/png" }));

		expect(progress).toContain(
			"Converting cat.gif to an animated PNG: trying 320×320, 256 colors, 30 fps",
		);
		expect((await screen.findByText(/^Converted/u)).textContent).toBe(
			"Converted cat.gif: 320×320, 30 fps, 284 KiB",
		);
		expect(screen.getByRole("status")).toBe(screen.getByText(/^Converted/u));
		expect(api.addSticker).toHaveBeenCalledOnce();
	});

	it("cancels converting an added animation", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		renderApp(api, (image, limits, options) => {
			options?.onProgress?.({ step: "decode", done: 1, total: 40 });
			return encodeUntilAborted(image, limits, options);
		});
		const animation = new File(["gif"], "cat.gif", { type: "image/gif" });

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: [animation] },
		});
		await fireEvent.click(await screen.findByRole("button", { name: "Cancel converting cat.gif" }));

		await vi.waitFor(() => {
			expect(screen.queryByRole("status")).toBeNull();
		});
		expect(screen.queryByRole("alert")).toBeNull();
		expect(api.addSticker).not.toHaveBeenCalled();
	});

	it("moves focus to the next conversion's Cancel, then to Add images", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		renderApp(api, encodeUntilAborted);
		const animations = ["cat.gif", "dog.gif"].map(
			(name) => new File(["gif"], name, { type: "image/gif" }),
		);

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: animations },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Cancel converting cat.gif" }));
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Cancel converting dog.gif" }),
			);
		});
		await fireEvent.click(screen.getByRole("button", { name: "Cancel converting dog.gif" }));

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(screen.getByLabelText("Add images"));
		});
	});

	it("keeps the pack editable while an image converts", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		renderApp(api, encodeUntilAborted);

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: [new File(["gif"], "cat.gif", { type: "image/gif" })] },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Remove sticker 2" }));

		await vi.waitFor(() => {
			expect(api.removeSticker).toHaveBeenCalledWith(1, "002.png");
		});
		expect(screen.getByRole("status").textContent).toContain("Converting cat.gif");
	});

	it("says which added animations became still images", async () => {
		const api = fakeApi();
		api.getPack.mockResolvedValue(packResponse());
		renderApp(api, (image, _, options) => {
			options?.onFlattened?.();
			return Promise.resolve(image);
		});
		const animation = new File(["gif"], "cat.gif", { type: "image/gif" });

		await fireEvent.change(await screen.findByLabelText("Add images"), {
			target: { files: [animation] },
		});

		expect((await screen.findByRole("status")).textContent).toBe(
			"This browser cannot convert animations, so these became still images: cat.gif. To keep them animated, update the browser and add them again.",
		);
	});
});
