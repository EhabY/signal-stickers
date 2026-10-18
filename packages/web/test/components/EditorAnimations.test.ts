import { fireEvent, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { CATS, files } from "../support/api.ts";
import { DRAWN_URL, stubImageDrawing } from "../support/drawing.ts";
import { animatedWebp, imageSource, renderEditor } from "../support/editor.ts";

vi.mock("emoji-picker-element", () => ({}));
const drawing = stubImageDrawing();

describe("Editor with animations Signal does not animate", () => {
	it("shows only the first frame of an animation Signal does not animate", async () => {
		renderEditor({ issues: [animatedWebp("001.png")] });

		await vi.waitFor(() => {
			expect(imageSource("Sticker 1 (cover)")).toBe(DRAWN_URL);
			expect(imageSource("Current cover")).toBe(DRAWN_URL);
		});
		expect(drawing.fetchImage).toHaveBeenCalledWith("/stickers/001.png", expect.anything());
		expect(imageSource("Sticker 2")).toBe("/stickers/002.png");
	});

	it("revokes the first frame once it is no longer shown", async () => {
		const { rerender } = renderEditor({ issues: [animatedWebp("001.png")] });
		await vi.waitFor(() => {
			expect(imageSource("Current cover")).toBe(DRAWN_URL);
		});

		await rerender({ issues: [] });

		expect(imageSource("Current cover")).toBe("/stickers/001.png");
		await vi.waitFor(() => {
			expect(drawing.revokeObjectURL.mock.calls).toEqual([[DRAWN_URL], [DRAWN_URL]]);
		});
	});

	it("shows the image as it is when its first frame cannot be drawn", async () => {
		drawing.decodeImage.mockRejectedValueOnce(new Error("Cannot decode"));

		renderEditor({ pack: { ...CATS, cover: "cover.webp" }, issues: [animatedWebp("cover.webp")] });

		await vi.waitFor(() => {
			expect(imageSource("Current cover")).toBe("/stickers/cover.webp");
		});
	});

	it("converts the sticker clicked, though another shares its image, from its card", async () => {
		const stickers = CATS.stickers.with(1, { file: "003.webp" });
		const { onconvert } = renderEditor({
			pack: { ...CATS, stickers },
			issues: [animatedWebp("003.webp")],
		});

		await fireEvent.click(
			screen.getByRole("button", { name: "Convert sticker 3 to an animated PNG" }),
		);

		expect(onconvert).toHaveBeenCalledWith([{ index: 2, file: "003.webp" }]);
		expect(screen.getAllByRole("button", { name: /^Convert sticker/u })).toHaveLength(2);
	});

	it("converts a separate cover Signal would not animate", async () => {
		const { onconvert } = renderEditor({
			pack: { ...CATS, cover: "cover.webp" },
			issues: [animatedWebp("cover.webp")],
		});

		await fireEvent.click(
			screen.getByRole("button", { name: "Convert the cover to an animated PNG" }),
		);

		expect(onconvert).toHaveBeenCalledWith([{ file: "cover.webp" }]);
	});

	it("converts every animation Signal would not animate at once", async () => {
		const { onconvert } = renderEditor({
			pack: { ...CATS, cover: "cover.webp" },
			issues: [animatedWebp("001.png"), animatedWebp("003.webp"), animatedWebp("cover.webp")],
		});

		await fireEvent.click(screen.getByRole("button", { name: "Convert all to animated PNG" }));

		expect(onconvert).toHaveBeenCalledWith([
			{ index: 0, file: "001.png" },
			{ index: 2, file: "003.webp" },
			{ file: "cover.webp" },
		]);
	});

	it.each([
		["sticker 3", () => screen.getByRole("button", { name: "Choose an emoji for sticker 3" })],
		["the cover", () => screen.getByLabelText("Replace the cover image")],
		["all", () => screen.getByText("Ready to publish.")],
	])("keeps focus nearby once converting %s is done", async (target, focused) => {
		const { rerender } = renderEditor({
			pack: { ...CATS, cover: "cover.webp" },
			issues: [animatedWebp("003.webp"), animatedWebp("cover.webp")],
		});

		await fireEvent.click(
			screen.getByRole("button", { name: new RegExp(`^Convert ${target}`, "u") }),
		);
		await rerender({ converting: ["003.webp", "cover.webp"] });
		await rerender({ converting: [], issues: [] });

		expect(document.activeElement).toBe(focused());
	});

	it("keeps every sticker editable while its image converts", async () => {
		const { onremove, changed } = renderEditor({
			issues: [animatedWebp("003.webp")],
			converting: ["003.webp"],
		});

		await fireEvent.click(screen.getByRole("button", { name: "Move sticker 3 earlier" }));
		await fireEvent.click(screen.getByRole("button", { name: "Remove sticker 3" }));

		expect(files(changed()!)).toEqual(["001.png", "003.webp", "002.png"]);
		expect(onremove).toHaveBeenCalledWith(2, "003.webp");
		expect(screen.getByRole("button", { name: "Choose an emoji for sticker 3" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.getByText("Converting…")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Convert/u })).toBeNull();
	});
});
