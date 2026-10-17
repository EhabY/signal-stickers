import type { PackResponse } from "@signal-stickers/server/api";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import ImportView from "../../src/components/ImportView.svelte";
import { LiveProgress } from "../../src/lib/events.svelte.ts";
import { fakeApi, packResponse } from "../support/api.ts";
import { stubModalDialogs } from "../support/dialog.ts";

const LINK = "https://signal.art/addstickers/#pack_id=abc&pack_key=def";

stubModalDialogs();

async function importLink(packTitle?: string) {
	const api = fakeApi();
	const onpulled = vi.fn<(response: PackResponse) => void>();
	render(ImportView, { api, progress: new LiveProgress(), packTitle, onpulled });
	await fireEvent.input(screen.getByLabelText("Sticker pack link"), { target: { value: LINK } });
	await fireEvent.click(screen.getByRole("button", { name: "Import pack" }));
	return { api, onpulled };
}

describe("ImportView", () => {
	it("imports right away when no pack is being edited", async () => {
		const { api, onpulled } = await importLink();

		expect(screen.queryByRole("dialog")).toBeNull();
		await vi.waitFor(() => {
			expect(onpulled).toHaveBeenCalledWith(packResponse());
		});
		expect(api.pull).toHaveBeenCalledWith(LINK);
	});

	it("asks before replacing the pack being edited", async () => {
		const { api, onpulled } = await importLink("Zuck It");

		const dialog = screen.getByRole("dialog", { name: 'Replace "Zuck It"?' });
		expect(dialog).toHaveProperty("open", true);
		expect(api.pull).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Replace" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		await vi.waitFor(() => {
			expect(onpulled).toHaveBeenCalledOnce();
		});
		expect(api.pull).toHaveBeenCalledWith(LINK);
	});

	it("returns focus to the form when the import fails after replacing", async () => {
		const { api } = await importLink("Zuck It");
		api.pull.mockRejectedValue(new Error("Pack not found"));

		await fireEvent.click(screen.getByRole("button", { name: "Replace" }));

		expect((await screen.findByRole("alert")).textContent).toContain("Pack not found");
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import pack" }));
		});
	});

	it("names an untitled pack generically", async () => {
		await importLink("");

		expect(screen.getByRole("dialog", { name: "Replace the pack you are editing?" })).toBeTruthy();
	});

	it.each([
		["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
		// The browser closes a modal dialog on Escape.
		["Escape", () => fireEvent(screen.getByRole("dialog"), new Event("close"))],
	])("keeps the pack being edited when %s closes the question", async (_, close) => {
		const { api } = await importLink("Zuck It");

		await close();

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "Import pack" }));
		});
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByLabelText("Sticker pack link")).toHaveProperty("value", LINK);
		expect(api.pull).not.toHaveBeenCalled();
	});
});
