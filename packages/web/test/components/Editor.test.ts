import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Editor from "../../src/components/Editor.svelte";
import type { Pack, ValidationIssue } from "../../src/lib/api.ts";
import { CATS, files, LIMITS } from "../support/api.ts";
import { stubModalDialogs } from "../support/dialog.ts";

// The real picker fetches its emoji data from a CDN; tests drive the element's events instead.
vi.mock("emoji-picker-element", () => ({}));
stubModalDialogs();

function renderEditor({
	pack = CATS,
	issues = [],
}: { pack?: Pack; issues?: ValidationIssue[] } = {}) {
	const onchange = vi.fn<(pack: Pack) => void>();
	const onremove = vi.fn<(index: number, file: string) => void>();
	const oncover = vi.fn<(image: File) => void>();
	render(Editor, {
		pack,
		issues,
		limits: LIMITS,
		imageUrl: (file) => `/stickers/${file}`,
		onchange,
		onadd: vi.fn<(images: File[]) => void>(),
		onremove,
		oncover,
	});
	return { onremove, oncover, changed: () => onchange.mock.lastCall?.[0] };
}

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

describe("Editor", () => {
	it("reorders stickers by dragging one onto another", async () => {
		const { changed } = renderEditor();
		const [first, , third] = stickerCards();

		await fireEvent.dragStart(first!);
		await fireEvent.dragOver(third!);
		await fireEvent.drop(third!);

		expect(files(changed()!)).toEqual(["002.png", "003.webp", "001.png"]);
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
		const picker = screen.getByRole("dialog", { name: "Emoji for sticker 3" });
		picker
			.querySelector("emoji-picker")!
			.dispatchEvent(new CustomEvent("emoji-click", { detail: { unicode: "🐱" } }));

		expect(changed()!.stickers[2]).toEqual({ file: "003.webp", emoji: "🐱" });
		await vi.waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
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

	it("marks the cover sticker as pressed and makes another sticker the cover", async () => {
		const { changed } = renderEditor();
		expect(coverButton(1).getAttribute("aria-pressed")).toBe("true");
		expect(coverButton(1).getAttribute("aria-disabled")).toBe("true");
		expect(coverButton(2).getAttribute("aria-pressed")).toBe("false");
		expect(coverButton(2).getAttribute("aria-disabled")).toBe("false");

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

	it("switches from a separate cover back to the first sticker", async () => {
		const { changed } = renderEditor({ pack: { ...CATS, cover: "cover.webp" } });
		expect(coverButton(1).getAttribute("aria-pressed")).toBe("false");

		await fireEvent.click(screen.getByRole("button", { name: "Use a sticker instead" }));

		expect(changed()).toEqual({ ...CATS, cover: "001.png" });
	});

	it("counts the stickers against the limit", () => {
		renderEditor();

		expect(screen.getByText("3 / 200 stickers")).toBeTruthy();
	});

	it("shows issues with the field and the sticker they concern", () => {
		renderEditor({
			pack: { ...CATS, title: "" },
			issues: [
				{ code: "missingTitle", message: "Give the pack a title" },
				{ code: "missingEmoji", message: "003.webp needs an emoji", file: "003.webp" },
			],
		});

		const title = screen.getByRole("textbox", { name: "Title" });
		const [first, , third] = stickerCards();
		expect(screen.getByRole("heading", { name: "2 things to fix before publishing" })).toBeTruthy();
		expect(title.getAttribute("aria-invalid")).toBe("true");
		expect(description(title)).toBe("Give the pack a title");
		expect(description(third!)).toBe("003.webp needs an emoji");
		expect(description(first!)).toBeUndefined();
	});

	it("says the pack is ready when nothing needs fixing", () => {
		renderEditor();

		expect(screen.getByText("Ready to publish.")).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Title" }).getAttribute("aria-invalid")).toBe(
			"false",
		);
	});
});
