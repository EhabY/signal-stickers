import { describe, expect, it, vi } from "vitest";

import { PackSession } from "../../src/lib/packSession.svelte.ts";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { CATS, fakeApi, files, LIMITS, packResponse } from "../support/api.ts";

const ADDED = { ...CATS, stickers: [...CATS.stickers, { file: "004.webp" }] };

function session() {
	const api = fakeApi();
	const encode = vi.fn<StickerEncoder>(() => Promise.resolve(new Blob(["webp"])));
	const editing = new PackSession(api, encode);
	editing.load(packResponse());
	return { api, encode, editing };
}

describe("PackSession", () => {
	it("saves quick edits once, with the latest pack and its issues", async () => {
		const { api, editing } = session();
		const issue = { code: "missingTitle", message: "Give the pack a title" } as const;
		api.savePack.mockResolvedValue(packResponse({ ...CATS, title: "" }, [issue]));

		editing.edit({ ...CATS, title: "C" });
		editing.edit({ ...CATS, title: "" });
		await editing.save();

		expect(api.savePack.mock.calls).toEqual([[{ ...CATS, title: "" }]]);
		expect(editing.issues).toEqual([issue]);
	});

	it("reports a failed save until one succeeds", async () => {
		const { api, editing } = session();
		api.savePack.mockRejectedValueOnce(new Error("offline"));

		editing.edit({ ...CATS, title: "Dogs" });
		await expect(editing.save()).rejects.toThrow("offline");
		const failed = editing.saveError;
		editing.edit({ ...CATS, title: "Dogs!" });
		await editing.save();

		expect(failed).toBe("Could not save your changes: offline");
		expect(editing.saveError).toBeUndefined();
	});

	it("retries a failed save before adding images", async () => {
		const { api, editing } = session();
		api.savePack.mockRejectedValueOnce(new Error("offline"));
		editing.edit({ ...CATS, title: "Dogs" });
		await expect(editing.save()).rejects.toThrow("offline");

		await editing.add([new File(["png"], "cat.png", { type: "image/png" })], LIMITS);

		expect(api.savePack.mock.calls).toEqual([
			[{ ...CATS, title: "Dogs" }],
			[{ ...CATS, title: "Dogs" }],
		]);
		expect(api.addSticker).toHaveBeenCalledOnce();
		expect(editing.saveError).toBeUndefined();
	});

	it("forgets a failed save when another pack loads", async () => {
		const { api, editing } = session();
		api.savePack.mockRejectedValueOnce(new Error("offline"));
		editing.edit({ ...CATS, title: "Dogs" });
		await expect(editing.save()).rejects.toThrow("offline");

		editing.load(packResponse());
		await editing.remove(2, "003.webp");

		expect(api.savePack).toHaveBeenCalledOnce();
		expect(api.removeSticker).toHaveBeenCalledWith(2, "003.webp");
		expect([editing.saveError, editing.error]).toEqual([undefined, undefined]);
	});

	it("saves pending edits before converting and adding images", async () => {
		const { api, encode, editing } = session();
		api.addSticker.mockResolvedValue({ ...packResponse(ADDED), file: "004.webp" });
		const image = new File(["png"], "cat.png", { type: "image/png" });

		editing.edit({ ...CATS, title: "Dogs" });
		await editing.add([image], LIMITS);

		expect(api.savePack).toHaveBeenCalledWith({ ...CATS, title: "Dogs" });
		expect(encode).toHaveBeenCalledWith(image, LIMITS);
		expect(api.addSticker).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(files(editing.pack!)).toEqual(files(ADDED));
		expect(editing.busy).toBe(false);
	});

	it("converts a cover image and makes it the separate cover", async () => {
		const { api, encode, editing } = session();
		const image = new File(["png"], "cover.png", { type: "image/png" });

		await editing.setCover(image, LIMITS);

		expect(encode).toHaveBeenCalledWith(image, LIMITS);
		expect(api.setCover).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(editing.pack?.cover).toBe("cover.webp");
	});

	it("adds the images it can and names the ones it cannot", async () => {
		const { api, encode, editing } = session();
		encode.mockRejectedValueOnce(new Error("The browser cannot read this image"));
		api.addSticker.mockResolvedValue({ ...packResponse(ADDED), file: "004.webp" });

		await editing.add(
			[new File([""], "broken.gif"), new File(["png"], "cat.png", { type: "image/png" })],
			LIMITS,
		);

		expect(api.addSticker).toHaveBeenCalledOnce();
		expect(editing.error).toBe("broken.gif: The browser cannot read this image");
		expect(files(editing.pack!)).toEqual(files(ADDED));
	});
});
