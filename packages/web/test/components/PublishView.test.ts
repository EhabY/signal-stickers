import type { StatusResponse } from "@signal-stickers/server/api";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";

import PublishView from "../../src/components/PublishView.svelte";
import { ApiError, type ValidationIssue } from "../../src/lib/api.ts";
import { LiveProgress } from "../../src/lib/events.svelte.ts";
import { PackSession } from "../../src/lib/packSession.svelte.ts";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { CATS, fakeApi, LIMITS, LINKED, packResponse, UNLINKED } from "../support/api.ts";

type PublishOptions = { status?: StatusResponse; issues?: readonly ValidationIssue[] };

function renderPublish({ status = LINKED, issues = [] }: PublishOptions = {}) {
	const api = fakeApi();
	const encode = vi.fn<StickerEncoder>();
	const session = new PackSession(api, encode);
	session.load(packResponse(CATS, issues));
	render(PublishView, {
		status,
		session,
		progress: new LiveProgress(),
		onaccount: vi.fn<() => void>(),
	});
	return {
		api,
		session,
		encode,
		publish: screen.getByRole("button", { name: "Publish to Signal production" }),
	};
}

describe("PublishView", () => {
	it("saves pending edits, publishes, and shows the new link", async () => {
		const { api, session, publish } = renderPublish();
		session.edit({ ...CATS, title: "Dogs" });

		await fireEvent.click(publish);

		const link = await screen.findByRole("link");
		expect(link.getAttribute("href")).toBe("https://signal.art/addstickers/#pack_id=new");
		expect(api.savePack).toHaveBeenCalledWith({ ...CATS, title: "Dogs" });
		expect(api.push).toHaveBeenCalledOnce();
	});

	it("publishes a pack once, until it changes", async () => {
		const { session, publish } = renderPublish();

		await fireEvent.click(publish);
		await screen.findByRole("link");
		expect(publish).toHaveProperty("disabled", true);
		session.edit({ ...CATS, title: "Dogs" });
		await tick();

		expect(publish).toHaveProperty("disabled", false);
		expect(screen.getByRole("link")).toBeTruthy();
	});

	it.each<[string, PublishOptions]>([
		["the account is not linked", { status: UNLINKED }],
		[
			"the pack has issues",
			{ issues: [{ code: "missingTitle", severity: "error", message: "Add a title" }] },
		],
	])("cannot publish while %s", (_, options) => {
		const { publish } = renderPublish(options);

		expect(publish).toHaveProperty("disabled", true);
	});

	it("waits for the images being converted before publishing", async () => {
		const { session, encode, publish } = renderPublish();
		const converted = Promise.withResolvers<Blob>();
		encode.mockReturnValue(converted.promise);

		const adding = session.add([new File(["gif"], "cat.gif")], LIMITS);
		await tick();
		expect(publish).toHaveProperty("disabled", true);
		expect(screen.getByText(/^Publishing waits/u)).toBeTruthy();
		converted.resolve(new Blob(["webp"]));
		await adding;
		await tick();

		expect(publish).toHaveProperty("disabled", false);
	});

	it("shows why the server refused the pack", async () => {
		const { api, publish } = renderPublish();
		const issue = {
			code: "tooLarge",
			severity: "error",
			message: "001.png is over 300 KiB",
			file: "001.png",
		} as const;
		api.push.mockRejectedValue(new ApiError(422, "The pack is not ready", [issue]));

		await fireEvent.click(publish);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("The pack is not ready");
		expect(alert.textContent).toContain("001.png is over 300 KiB");
	});
});
