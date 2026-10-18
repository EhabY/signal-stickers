import { describe, expect, it, vi } from "vitest";

import { PackSession } from "../../src/lib/packSession.svelte.ts";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { encodeUntilAborted } from "../support/animation.ts";
import { CATS, fakeApi, files, LIMITS, packResponse } from "../support/api.ts";

const ADDED = { ...CATS, stickers: [...CATS.stickers, { file: "004.webp" }] };
const DOGS = { ...CATS, title: "Dogs" };

function images(...names: string[]): File[] {
	return names.map((name) => new File(["gif"], name, { type: "image/gif" }));
}

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
		expect(encode).toHaveBeenCalledWith(image, LIMITS, expect.any(Object));
		expect(api.addSticker).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(files(editing.pack!)).toEqual(files(ADDED));
		expect(editing.busy).toBe(false);
	});

	it("converts a cover image and makes it the separate cover", async () => {
		const { api, encode, editing } = session();
		const image = new File(["png"], "cover.png", { type: "image/png" });

		await editing.setCover(image, LIMITS);

		expect(encode).toHaveBeenCalledWith(image, LIMITS, expect.any(Object));
		expect(api.setCover).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(editing.pack?.cover).toBe("cover.webp");
	});

	it("shows an animation's conversion until it is added", async () => {
		const { encode, editing } = session();
		const progress = { step: "decode", done: 1, total: 2 } as const;
		const shown: unknown[] = [];
		encode.mockImplementation((_, __, options) => {
			options?.onProgress?.(progress);
			shown.push(editing.conversion);
			return Promise.resolve(new Blob(["apng"]));
		});

		await editing.add(images("cat.gif"), LIMITS);

		expect(shown).toEqual([{ file: "cat.gif", progress }]);
		expect(editing.conversion).toBeUndefined();
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

	it("names the animations that became still images", async () => {
		const { encode, editing } = session();
		encode.mockImplementation((image, __, options) => {
			options?.onFlattened?.();
			return Promise.resolve(image);
		});

		await editing.add(images("cat.gif", "dog.gif"), LIMITS);

		expect(editing.flattened).toEqual(["cat.gif", "dog.gif"]);
	});

	it("stops converting and adding images when canceled", async () => {
		const { api, encode, editing } = session();
		encode.mockImplementation(encodeUntilAborted);

		const adding = editing.add(images("cat.gif", "dog.gif"), LIMITS);
		await vi.waitFor(() => {
			expect(encode).toHaveBeenCalledOnce();
		});
		editing.cancel();
		await adding;

		expect(encode).toHaveBeenCalledOnce();
		expect(api.addSticker).not.toHaveBeenCalled();
		expect([editing.error, editing.conversion, editing.busy]).toEqual([
			undefined,
			undefined,
			false,
		]);
	});

	it("stops converting when another pack loads", async () => {
		const { api, encode, editing } = session();
		encode.mockImplementation(encodeUntilAborted);

		const adding = editing.add(images("cat.gif"), LIMITS);
		await vi.waitFor(() => {
			expect(encode).toHaveBeenCalledOnce();
		});
		editing.load(packResponse(DOGS));
		await adding;

		expect(api.addSticker).not.toHaveBeenCalled();
		expect([editing.pack, editing.error]).toEqual([DOGS, undefined]);
	});

	it("ignores the answer to an add that was sent before another pack loaded", async () => {
		const { api, editing } = session();
		const added = Promise.withResolvers<Awaited<ReturnType<typeof api.addSticker>>>();
		api.addSticker.mockReturnValue(added.promise);

		const adding = editing.add(images("cat.gif"), LIMITS);
		await vi.waitFor(() => {
			expect(api.addSticker).toHaveBeenCalledOnce();
		});
		editing.load(packResponse(DOGS));
		added.resolve({ ...packResponse(ADDED), file: "004.webp" });
		await adding;

		expect(editing.pack).toEqual(DOGS);
	});
});
