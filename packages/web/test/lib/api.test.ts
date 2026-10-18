import { describe, expect, it, vi } from "vitest";

import { ApiError, createApi } from "../../src/lib/api.ts";
import { CATS, packResponse, UNLINKED } from "../support/api.ts";

function serve(body: unknown, status = 200) {
	const fetch = vi.fn<typeof globalThis.fetch>(() =>
		Promise.resolve(Response.json(body, { status })),
	);
	return { api: createApi(fetch), fetch };
}

describe("createApi", () => {
	it("sends a pack as JSON and returns the server's answer", async () => {
		const { api, fetch } = serve(packResponse());

		const response = await api.savePack(CATS);

		const [path, init] = fetch.mock.calls[0]!;
		expect(response).toEqual(packResponse());
		expect({ path, method: init?.method, headers: init?.headers }).toEqual({
			path: "/api/pack",
			method: "PUT",
			headers: { "Content-Type": "application/json" },
		});
		expect(init?.body).toBe(JSON.stringify(CATS));
	});

	it("uploads an added image as is", async () => {
		const { api, fetch } = serve({ ...packResponse(), file: "004.webp" });
		const image = new Blob(["webp"], { type: "image/webp" });

		await api.addSticker(image);

		const [path, init] = fetch.mock.calls[0]!;
		expect({ path, body: init?.body, headers: init?.headers }).toEqual({
			path: "/api/pack/sticker",
			body: image,
			headers: { "Content-Type": "image/webp" },
		});
	});

	it("replaces a sticker's image with the image as is", async () => {
		const { api, fetch } = serve(packResponse());
		const image = new Blob(["apng"], { type: "image/png" });

		await api.replaceSticker(1, "002.webp", image);

		const [path, init] = fetch.mock.calls[0]!;
		expect({ path, method: init?.method, body: init?.body }).toEqual({
			path: "/api/pack/sticker/1/002.webp",
			method: "PUT",
			body: image,
		});
	});

	it("downloads an image", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response("webp")));

		const image = await createApi(fetch).getImage("my cat#1.webp");

		expect(fetch.mock.calls[0]?.[0]).toBe("/api/pack/sticker/my%20cat%231.webp");
		expect(await image.text()).toBe("webp");
	});

	it("rejects a failed download with the server's message", async () => {
		const { api } = serve({ error: "002.webp is not in the pack" }, 404);

		await expect(api.getImage("002.webp")).rejects.toThrow("002.webp is not in the pack");
	});

	it("encodes file names into sticker paths", async () => {
		const { api, fetch } = serve(packResponse());

		await api.removeSticker(2, "my cat#1.png");

		expect(fetch.mock.calls[0]?.[0]).toBe("/api/pack/sticker/2/my%20cat%231.png");
		expect(api.stickerUrl("my cat#1.png", 3)).toBe("/api/pack/sticker/my%20cat%231.png?v=3");
	});

	it("reports a missing working copy as undefined", async () => {
		const { api } = serve({ error: "No pack" }, 404);

		expect(await api.getPack()).toBeUndefined();
	});

	it("rejects with the server's message and the issues that refused a push", async () => {
		const issue = { code: "missingEmoji", message: "003.webp needs an emoji", file: "003.webp" };
		const { api } = serve({ error: "The pack is not ready", issues: [issue] }, 422);

		const error = await api.push().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 422, message: "The pack is not ready", issues: [issue] });
	});

	it("rejects a response that does not match the route", async () => {
		const { api } = serve(UNLINKED);

		await expect(api.getPack()).rejects.toThrow("Unexpected response to GET /api/pack");
	});
});
