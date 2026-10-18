import { describe, expect, it, vi } from "vitest";

import type { Api } from "../../src/lib/api.ts";
import { encodeUntilAborted } from "../support/animation.ts";
import { CATS, files, LIMITS, packResponse } from "../support/api.ts";
import { ADDED, convertLater, images, servedSession, session } from "../support/session.ts";

const DOGS = { ...CATS, title: "Dogs" };
const LINK = "https://signal.art/addstickers/#pack_id=abc&pack_key=def";

describe("PackSession while images convert", () => {
	it("cancels one conversion and keeps converting the rest", async () => {
		const { api, encode, editing } = session();
		encode.mockImplementationOnce(encodeUntilAborted);

		const adding = editing.add(images("cat.gif", "dog.gif"), LIMITS);
		const queued = editing.conversions.list.map(({ file, waiting }) => [file, waiting]);
		await vi.waitFor(() => {
			expect(encode).toHaveBeenCalledOnce();
		});
		editing.conversions.cancel(editing.conversions.list[0]!.id);
		await adding;

		expect(queued).toEqual([
			["cat.gif", false],
			["dog.gif", true],
		]);
		expect(encode.mock.calls.map(([image]) => image)).toMatchObject([
			{ name: "cat.gif" },
			{ name: "dog.gif" },
		]);
		expect(api.addSticker).toHaveBeenCalledOnce();
		expect([editing.error, editing.conversions.list, editing.pending]).toEqual([
			undefined,
			[],
			false,
		]);
	});

	it("keeps editing the pack while an image converts", async () => {
		const { encode, editing, stored } = servedSession();
		const finishConverting = convertLater(encode);
		const stickers = CATS.stickers.with(2, { file: "003.webp", emoji: "🐶" });

		const adding = editing.add(images("cat.gif"), LIMITS);
		editing.edit({ ...CATS, title: "Dogs", stickers });
		await editing.remove(0, "001.png");
		finishConverting();
		await adding;
		await editing.save();

		expect(editing.pack).toEqual({
			...CATS,
			title: "Dogs",
			cover: "002.png",
			stickers: [...stickers.slice(1), { file: "004.webp" }],
		});
		expect(stored()).toEqual(editing.pack);
	});

	it("sends one change at a time and applies it to the edits made meanwhile", async () => {
		const { api, editing, answerLater, stored } = servedSession();
		const answerRemoval = answerLater();

		const removing = editing.remove(2, "003.webp");
		await vi.waitFor(() => {
			expect(api.removeSticker).toHaveBeenCalledOnce();
		});
		editing.edit({ ...CATS, title: "Dogs" });
		const saving = editing.save();
		await Promise.resolve();
		const savedWhileRemoving = api.savePack.mock.calls.length;
		answerRemoval();
		await Promise.all([removing, saving]);

		expect(savedWhileRemoving).toBe(0);
		expect(editing.pack).toEqual({ ...CATS, title: "Dogs", stickers: CATS.stickers.slice(0, 2) });
		expect(stored()).toEqual(editing.pack);
	});

	it("converts a sticker in place where it moved to while converting", async () => {
		const { api, encode, editing, stored } = servedSession();
		const finishConverting = convertLater(encode);

		const converting = editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);
		editing.edit({ ...CATS, stickers: CATS.stickers.toReversed() });
		finishConverting();
		await converting;

		expect(api.replaceSticker).toHaveBeenCalledWith(0, "003.webp", expect.any(Blob));
		expect(files(editing.pack!)).toEqual(["004.png", "002.png", "001.png"]);
		expect(stored()).toEqual(editing.pack);
	});

	it("stops converting a sticker once it is removed", async () => {
		const { api, encode, editing } = servedSession();
		encode.mockImplementation(encodeUntilAborted);

		const converting = editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);
		await vi.waitFor(() => {
			expect(encode).toHaveBeenCalledOnce();
		});
		await editing.remove(2, "003.webp");
		await converting;

		expect(encode.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
		expect(api.replaceSticker).not.toHaveBeenCalled();
		expect([editing.error, editing.conversions.list]).toEqual([undefined, []]);
	});

	it("drops a converted sticker that was removed before its turn", async () => {
		const { api, encode, editing, answerLater, stored } = servedSession();
		const finishConverting = convertLater(encode);
		const answerRemoval = answerLater();

		const converting = editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);
		const removing = editing.remove(2, "003.webp");
		finishConverting();
		await vi.waitFor(() => {
			expect(editing.conversions.list).toEqual([]);
		});
		answerRemoval();
		await Promise.all([converting, removing]);

		expect(api.replaceSticker).not.toHaveBeenCalled();
		expect(editing.error).toBeUndefined();
		expect(files(stored())).toEqual(["001.png", "002.png"]);
	});

	it("stops converting a cover once another cover is chosen", async () => {
		const { api, encode, editing } = session();
		encode.mockImplementation(encodeUntilAborted);

		const converting = editing.setCover(new File(["png"], "cover.png"), LIMITS);
		editing.edit({ ...CATS, cover: "002.png" });
		await converting;

		expect(api.setCover).not.toHaveBeenCalled();
		expect([editing.pack?.cover, editing.error, editing.conversions.list]).toEqual([
			"002.png",
			undefined,
			[],
		]);
	});

	it("is pending until every conversion and its change are done", async () => {
		const { api, encode, editing } = session();
		const finishConverting = convertLater(encode);
		const added = Promise.withResolvers<Awaited<ReturnType<Api["addSticker"]>>>();
		api.addSticker.mockReturnValue(added.promise);

		const adding = editing.add(images("cat.gif"), LIMITS);
		const whileConverting = editing.pending;
		finishConverting();
		await vi.waitFor(() => {
			expect(api.addSticker).toHaveBeenCalledOnce();
		});
		const whileAdding = editing.pending;
		added.resolve({ ...packResponse(ADDED), file: "004.webp" });
		await adding;

		expect([whileConverting, whileAdding, editing.pending]).toEqual([true, true, false]);
	});

	it("locks editing and stops converting while importing another pack", async () => {
		const { api, encode, editing } = session();
		encode.mockImplementation(encodeUntilAborted);

		const adding = editing.add(images("cat.gif"), LIMITS);
		api.pull.mockResolvedValue(packResponse(DOGS));
		const pulling = editing.pull(LINK);
		const locked = editing.locked;
		await Promise.all([adding, pulling]);

		expect([locked, editing.locked]).toEqual([true, false]);
		expect(api.pull).toHaveBeenCalledWith(LINK);
		expect(api.addSticker).not.toHaveBeenCalled();
		expect([editing.pack, editing.conversions.list]).toEqual([DOGS, []]);
	});

	it("ignores the answer to an add that was sent before another pack loaded", async () => {
		const { api, editing } = session();
		const added = Promise.withResolvers<Awaited<ReturnType<Api["addSticker"]>>>();
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

describe("PackSession while changes wait their turn", () => {
	it("removes each sticker clicked before the first removal is answered", async () => {
		const { editing, answerLater, stored } = servedSession();
		const answerRemoval = answerLater();

		const removing = [editing.remove(0, "001.png"), editing.remove(1, "002.png")];
		answerRemoval();
		await Promise.all(removing);

		expect(files(stored())).toEqual(["003.webp"]);
		expect([editing.pack, editing.error]).toEqual([stored(), undefined]);
	});

	it("removes a sticker where it was moved before its removal was sent", async () => {
		const { editing, answerLater, stored } = servedSession();
		const answerSave = answerLater();

		editing.edit({ ...CATS, title: "Dogs" });
		const saving = editing.save();
		const removing = editing.remove(0, "001.png");
		editing.edit({ ...CATS, title: "Dogs", stickers: CATS.stickers.toReversed() });
		answerSave();
		await Promise.all([saving, removing]);

		expect(files(stored())).toEqual(["003.webp", "002.png"]);
		expect(editing.pack).toEqual(stored());
	});

	it("removes one sticker when Remove is clicked twice and another shares its image", async () => {
		const { editing, stored } = servedSession();
		editing.edit({ ...CATS, stickers: CATS.stickers.with(2, { file: "001.png" }) });
		await editing.save();

		await Promise.all([editing.remove(0, "001.png"), editing.remove(0, "001.png")]);

		expect(files(stored())).toEqual(["002.png", "001.png"]);
	});

	it("shows a sticker converting until its converted image is sent", async () => {
		const { api, editing, answerLater } = servedSession();
		const answerReplacement = answerLater();

		const converting = editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);
		await vi.waitFor(() => {
			expect(api.replaceSticker).toHaveBeenCalledOnce();
		});
		const whileSending = [editing.conversions.list, editing.conversions.inPlace];
		answerReplacement();
		await converting;

		expect(whileSending).toEqual([[], ["003.webp"]]);
		expect(editing.conversions.inPlace).toEqual([]);
	});

	it("removes a sticker whose converted image is still being sent", async () => {
		const { api, editing, answerLater, stored } = servedSession();
		const answerReplacement = answerLater();

		const converting = editing.convertAnimations([{ index: 2, file: "003.webp" }], LIMITS);
		await vi.waitFor(() => {
			expect(api.replaceSticker).toHaveBeenCalledOnce();
		});
		const removing = editing.remove(2, "003.webp");
		answerReplacement();
		await Promise.all([converting, removing]);

		expect(files(stored())).toEqual(["001.png", "002.png"]);
		expect([editing.pack, editing.error]).toEqual([stored(), undefined]);
	});

	it("uses the cover chosen though the cover sticker is removed while it converts", async () => {
		const { api, encode, editing } = servedSession();
		const finishConverting = convertLater(encode);

		const covering = editing.setCover(new File(["gif"], "cover.gif"), LIMITS);
		await editing.remove(0, "001.png");
		finishConverting();
		await covering;

		expect(api.setCover).toHaveBeenCalledOnce();
		expect([editing.pack?.cover, editing.error]).toEqual(["cover.webp", undefined]);
	});

	it("uses the cover chosen while another is being sent", async () => {
		const { api, encode, editing, answerLater } = servedSession();
		encode.mockImplementation((image) => Promise.resolve(image));
		const answerCover = answerLater();

		const covering = editing.setCover(new File(["png"], "a.png", { type: "image/png" }), LIMITS);
		await vi.waitFor(() => {
			expect(api.setCover).toHaveBeenCalledOnce();
		});
		const coveringAgain = editing.setCover(new File(["webp"], "b.webp"), LIMITS);
		answerCover();
		await Promise.all([covering, coveringAgain]);

		expect(api.setCover).toHaveBeenCalledTimes(2);
		expect(editing.pack?.cover).toBe("cover.webp");
	});
});
