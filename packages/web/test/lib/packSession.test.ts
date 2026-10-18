import { describe, expect, it } from "vitest";

import { CATS, files, LIMITS, packResponse } from "../support/api.ts";
import { ADDED, images, session } from "../support/session.ts";

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
		expect(editing.pending).toBe(false);
	});

	it("converts a cover image and makes it the separate cover", async () => {
		const { api, encode, editing } = session();
		const image = new File(["png"], "cover.png", { type: "image/png" });

		await editing.setCover(image, LIMITS);

		expect(encode).toHaveBeenCalledWith(image, LIMITS, expect.any(Object));
		expect(api.setCover).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(editing.pack?.cover).toBe("cover.webp");
	});

	it("converts a sticker's image to an animated PNG in its place", async () => {
		const { api, encode, editing } = session();
		const converted = { ...CATS, stickers: CATS.stickers.with(2, { file: "004.png" }) };
		api.replaceSticker.mockResolvedValue(packResponse(converted));

		await editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);

		const [image, limits, options] = encode.mock.calls[0]!;
		expect(image).toBeInstanceOf(File);
		expect(image).toMatchObject({ name: "003.webp", type: "image/webp" });
		expect([limits, options?.mustAnimate]).toEqual([LIMITS, true]);
		expect(api.getImage).toHaveBeenCalledWith("003.webp", expect.any(AbortSignal));
		expect(api.replaceSticker).toHaveBeenCalledWith(
			2,
			"003.webp",
			await encode.mock.results[0]!.value,
		);
		expect(editing.pack).toEqual(converted);
	});

	it("converts a separate cover through the cover route", async () => {
		const { api, encode, editing } = session();
		editing.load(packResponse({ ...CATS, cover: "cover.webp" }));

		await editing.convertAnimations([{ file: "cover.webp" }], LIMITS);

		expect(api.setCover).toHaveBeenCalledWith(await encode.mock.results[0]!.value);
		expect(api.replaceSticker).not.toHaveBeenCalled();
	});

	it("converts every image it can and names the ones it cannot", async () => {
		const { api, encode, editing } = session();
		encode.mockRejectedValueOnce(new Error("The animation does not fit"));
		api.replaceSticker.mockRejectedValueOnce(new Error("Disk full"));

		await editing.convertAnimations(
			[
				{ index: 0, file: "001.png" },
				{ index: 1, file: "002.png" },
				{ index: 2, file: "003.webp" },
			],
			LIMITS,
		);

		expect(api.replaceSticker.mock.calls.map(([index, file]) => [index, file])).toEqual([
			[1, "002.png"],
			[2, "003.webp"],
		]);
		expect(editing.error).toBe("001.png: The animation does not fit\n002.png: Disk full");
	});

	it("shows an animation's conversion until it is added", async () => {
		const { encode, editing } = session();
		const progress = { step: "decode", done: 1, total: 2 } as const;
		const shown: unknown[] = [];
		encode.mockImplementation((_, __, options) => {
			options?.onProgress?.(progress);
			shown.push(editing.conversions.list);
			return Promise.resolve(new Blob(["apng"]));
		});

		await editing.add(images("cat.gif"), LIMITS);

		expect(shown).toEqual([[{ id: 0, file: "cat.gif", inPlace: false, waiting: false, progress }]]);
		expect(editing.conversions.list).toEqual([]);
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
});
