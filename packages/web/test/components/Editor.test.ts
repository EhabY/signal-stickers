import { fireEvent, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import { CATS, files, missingEmoji } from "../support/api.ts";
import { stubModalDialogs } from "../support/dialog.ts";
import { renderEditor } from "../support/editor.ts";

// The real picker fetches its emoji data from a CDN; tests drive the element's events instead.
vi.mock("emoji-picker-element", () => ({}));
stubModalDialogs();

/** The text of what `aria-describedby` points at. */
function description(element: HTMLElement): string | undefined {
	const id = element.getAttribute("aria-describedby");
	return id === null ? undefined : document.querySelector(`[id="${id}"]`)?.textContent.trim();
}

function coverButton(number: number): HTMLElement {
	return screen.getByRole("button", { name: `Use sticker ${number} as the cover` });
}

function stickerCards(): HTMLElement[] {
	return within(screen.getByRole("list", { name: "Stickers" }))
		.getAllByRole("img")
		.map((image) => image.closest("li"))
		.filter((card) => card !== null);
}

function pickEmoji(picker: HTMLElement, emoji: string): void {
	picker
		.querySelector("emoji-picker")!
		.dispatchEvent(new CustomEvent("emoji-click", { detail: { unicode: emoji } }));
}

/** The server's answer to removing the first sticker of {@link CATS}. */
const FIRST_REMOVED = { ...CATS, cover: "002.png", stickers: CATS.stickers.slice(1) };

describe("Editor", () => {
	it("reorders stickers by dragging one onto another", async () => {
		const { changed } = renderEditor();
		const [first, , third] = stickerCards();

		await fireEvent.dragStart(first!);
		await fireEvent.dragOver(third!);
		await fireEvent.drop(third!);

		expect(files(changed()!)).toEqual(["002.png", "003.webp", "001.png"]);
	});

	it("drags the sticker picked up though a removal moves it", async () => {
		const { changed, rerender } = renderEditor();
		const [, , third] = stickerCards();

		await fireEvent.dragStart(third!);
		await rerender({ pack: FIRST_REMOVED });
		const [first] = stickerCards();
		await fireEvent.dragOver(first!);
		await fireEvent.drop(first!);

		expect(files(changed()!)).toEqual(["003.webp", "002.png"]);
	});

	it("shows stickers that share an image", () => {
		const stickers = [{ file: "001.png" }, { file: "001.png", emoji: "😺" }];

		renderEditor({ pack: { ...CATS, stickers } });

		expect(stickerCards()).toHaveLength(2);
	});

	it("removes the sticker clicked when stickers share an image", async () => {
		const stickers = [{ file: "001.png" }, { file: "001.png", emoji: "😺" }];
		const { onremove } = renderEditor({ pack: { ...CATS, stickers } });

		await fireEvent.click(screen.getByRole("button", { name: "Remove sticker 2" }));

		expect(onremove).toHaveBeenCalledWith(1, "001.png");
	});

	it("moves a sticker with its arrow buttons", async () => {
		const { changed } = renderEditor();

		await fireEvent.click(screen.getByRole("button", { name: "Move sticker 2 earlier" }));

		expect(files(changed()!)).toEqual(["002.png", "001.png", "003.webp"]);
		expect(screen.getByText("Moved sticker 2 to position 1.")).toBeTruthy();
	});

	it("assigns the emoji picked for a sticker and closes the picker", async () => {
		const { changed } = renderEditor();

		await fireEvent.click(screen.getByRole("button", { name: "Choose an emoji for sticker 3" }));
		pickEmoji(screen.getByRole("dialog", { name: "Emoji for sticker 3" }), "🐱");

		expect(changed()!.stickers[2]).toEqual({ file: "003.webp", emoji: "🐱" });
		await vi.waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("assigns the emoji to the sticker the picker opened for though a removal moves it", async () => {
		const { changed, rerender } = renderEditor();

		await fireEvent.click(screen.getByRole("button", { name: "Choose an emoji for sticker 3" }));
		await rerender({ pack: FIRST_REMOVED });
		pickEmoji(screen.getByRole("dialog", { name: "Emoji for sticker 2" }), "🐱");

		expect(changed()!.stickers).toEqual([
			{ file: "002.png", emoji: "😺" },
			{ file: "003.webp", emoji: "🐱" },
		]);
	});

	it("opens the picker as a modal dialog that Escape closes", async () => {
		renderEditor();

		await fireEvent.click(screen.getByRole("button", { name: "Choose an emoji for sticker 3" }));
		const picker = screen.getByRole("dialog", { name: "Emoji for sticker 3" });
		expect(picker).toHaveProperty("open", true);
		// The browser closes a modal dialog on Escape.
		await fireEvent(picker, new Event("close"));

		await vi.waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});

	it("labels the cover sticker and makes another sticker the cover", async () => {
		const { changed } = renderEditor();
		expect(screen.getByAltText("Sticker 1 (cover)")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Use sticker 1 as the cover" })).toBeNull();

		await fireEvent.click(coverButton(2));

		expect(changed()).toEqual({ ...CATS, cover: "002.png" });
	});

	it("uses a chosen image as a separate cover", async () => {
		const { oncover } = renderEditor();
		const image = new File(["png"], "cover.png", { type: "image/png" });

		await fireEvent.change(screen.getByLabelText("Upload a separate cover"), {
			target: { files: [image] },
		});

		expect(oncover).toHaveBeenCalledWith(image);
	});

	it("replaces a separate cover with another image", async () => {
		const { oncover } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		const image = new File(["png"], "cover.png", { type: "image/png" });

		await fireEvent.change(screen.getByLabelText("Replace the cover image"), {
			target: { files: [image] },
		});

		expect(oncover).toHaveBeenCalledWith(image);
	});

	it("asks before replacing an uploaded cover with the chosen sticker", async () => {
		const { changed } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		expect(screen.queryByRole("button", { name: "Use a sticker instead" })).toBeNull();

		await fireEvent.click(coverButton(2));

		expect(screen.getByRole("dialog", { name: "Replace the cover?" })).toHaveProperty("open", true);
		expect(changed()).toBeUndefined();
		await fireEvent.click(screen.getByRole("button", { name: "Use sticker" }));

		expect(changed()).toEqual({ ...CATS, cover: "002.png" });
	});

	it.each([
		["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
		["Escape", () => fireEvent(screen.getByRole("dialog"), new Event("close"))],
	])("keeps the uploaded cover when %s closes the confirmation", async (_, cancel) => {
		const { changed } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		await fireEvent.click(coverButton(2));

		await cancel();

		expect(changed()).toBeUndefined();
		expect(screen.queryByRole("dialog")).toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(coverButton(2));
		});
	});

	it("keeps a newer uploaded cover when an old confirmation is accepted", async () => {
		const { changed, rerender } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		await fireEvent.click(coverButton(2));
		await rerender({ pack: { ...CATS, cover: "new-cover.webp" } });

		await fireEvent.click(screen.getByRole("button", { name: "Use sticker" }));

		expect(changed()).toBeUndefined();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("uses the chosen sticker even if it moves before the confirmation", async () => {
		const { changed, rerender } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		await fireEvent.click(coverButton(3));
		const pack = { ...CATS, cover: "cover.webp", stickers: CATS.stickers.toReversed() };
		await rerender({ pack });

		await fireEvent.click(screen.getByRole("button", { name: "Use sticker" }));

		expect(changed()).toEqual({ ...pack, cover: "003.webp" });
	});

	it("keeps the uploaded cover if the chosen sticker is removed before confirmation", async () => {
		const { changed, rerender } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		await fireEvent.click(coverButton(1));
		await rerender({ pack: { ...CATS, cover: "cover.webp", stickers: CATS.stickers.slice(1) } });

		await fireEvent.click(screen.getByRole("button", { name: "Use sticker" }));

		expect(changed()).toBeUndefined();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("counts the stickers against the limit", () => {
		renderEditor();

		expect(screen.getByText("3 / 200 stickers")).toBeTruthy();
	});

	it("shows issues with the field and the sticker they concern", () => {
		renderEditor({
			pack: { ...CATS, title: "" },
			issues: [
				{ code: "missingTitle", severity: "error", message: "Give the pack a title" },
				{ code: "tooLarge", severity: "error", message: "003.webp is too large", file: "003.webp" },
			],
		});

		const title = screen.getByRole("textbox", { name: "Title" });
		const [first, , third] = stickerCards();
		expect(screen.getByRole("heading", { name: "2 things to fix before publishing" })).toBeTruthy();
		expect(title.getAttribute("aria-invalid")).toBe("true");
		expect(description(title)).toBe("Give the pack a title");
		expect(description(third!)).toBe("003.webp is too large");
		expect(description(first!)).toBeUndefined();
	});

	it("shows a sticker without an emoji as a warning, not an error", () => {
		renderEditor({ issues: [missingEmoji("003.webp")] });

		const emoji = screen.getByRole("button", { name: "Choose an emoji for sticker 3" });
		const [, , third] = stickerCards();
		expect(screen.getByRole("heading", { name: "Ready to publish." })).toBeTruthy();
		expect(
			screen.getByText("1 sticker has no emoji, so Signal won't suggest it while typing."),
		).toBeTruthy();
		expect(emoji.textContent.trim()).toBe("+");
		expect(emoji.classList.contains("empty")).toBe(true);
		expect(emoji.getAttribute("title")).toMatch(/^No emoji, so Signal won't suggest/u);
		expect(description(third!)).toBeUndefined();
	});

	it("counts only errors as things to fix, and stickers without an emoji apart", () => {
		const stickers = CATS.stickers.map(({ file }) => ({ file }));
		renderEditor({
			pack: { ...CATS, title: "", stickers },
			issues: [
				{ code: "missingTitle", severity: "error", message: "Give the pack a title" },
				...files(CATS).map((file) => missingEmoji(file)),
			],
		});

		const summary = screen.getByRole("heading", { name: "1 thing to fix before publishing" });
		expect(summary.nextElementSibling?.textContent.trim()).toBe("Give the pack a title");
		expect(
			screen.getByText("3 stickers have no emoji, so Signal won't suggest them while typing."),
		).toBeTruthy();
	});

	it("says the pack is ready when nothing needs fixing", () => {
		renderEditor();

		expect(screen.getByText("Ready to publish.")).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("aria-invalid")).toBe(
			"false",
		);
	});
});
