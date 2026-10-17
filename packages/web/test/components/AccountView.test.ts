import type { StatusResponse } from "@signal-stickers/server/api";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import AccountView from "../../src/components/AccountView.svelte";
import { LiveProgress } from "../../src/lib/events.svelte.ts";
import { fakeApi, LINKED, linkUntilAborted, QR_URL, UNLINKED } from "../support/api.ts";

function renderAccount(status = UNLINKED) {
	const api = fakeApi();
	const progress = new LiveProgress();
	const onstatus = vi.fn<(status: StatusResponse) => void>();
	render(AccountView, { api, status, progress, onstatus });
	return { api, progress, onstatus };
}

describe("AccountView", () => {
	it("shows the QR code to scan while linking", async () => {
		const { api, progress } = renderAccount();
		api.link.mockImplementation(linkUntilAborted);

		await fireEvent.click(screen.getByRole("button", { name: "Link to Signal production" }));
		progress.link = { step: "waitingForScan", qrUrl: QR_URL };

		expect(await screen.findByRole("img", { name: "QR code to link this device" })).toBeTruthy();
	});

	it("cancels linking without an error", async () => {
		const { api } = renderAccount();
		api.link.mockImplementation(linkUntilAborted);

		await fireEvent.click(screen.getByRole("button", { name: "Link to Signal production" }));
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(await screen.findByRole("button", { name: "Link to Signal production" })).toBeTruthy();
		expect(api.link.mock.calls[0]?.[0]?.aborted).toBe(true);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("unlinks once confirmed", async () => {
		const { api, onstatus } = renderAccount(LINKED);

		await fireEvent.click(screen.getByRole("button", { name: "Unlink this device" }));
		await fireEvent.click(screen.getByRole("button", { name: "Unlink" }));

		await vi.waitFor(() => {
			expect(onstatus).toHaveBeenCalledWith(UNLINKED);
		});
		expect(api.unlink).toHaveBeenCalledOnce();
	});

	it("warns when the device is linked on another environment", () => {
		renderAccount({ ...LINKED, env: "staging" });

		expect(
			screen.getByText(/linked to Signal production, but the server is using Signal staging/u),
		).toBeTruthy();
	});
});
