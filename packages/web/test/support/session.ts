import { vi } from "vitest";

import { ApiError, type Pack } from "../../src/lib/api.ts";
import { PackSession } from "../../src/lib/packSession.svelte.ts";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { CATS, fakeApi, packResponse } from "./api.ts";

export const ADDED: Pack = { ...CATS, stickers: [...CATS.stickers, { file: "004.webp" }] };

export function images(...names: string[]): File[] {
	return names.map((name) => new File(["gif"], name, { type: "image/gif" }));
}

export function session() {
	const api = fakeApi();
	const encode = vi.fn<StickerEncoder>(() => Promise.resolve(new Blob(["webp"])));
	const editing = new PackSession(api, encode);
	editing.load(packResponse());
	return { api, encode, editing };
}

/**
 * A session whose API changes one stored pack like the server, naming new images from 004. Calling
 * `answerLater` makes the next request wait for its answer until the function it returns is called.
 */
export function servedSession() {
	const { api, encode, editing } = session();
	let stored = CATS;
	let imageCount = 3;
	let answered = Promise.resolve();
	const store = async (pack: Pack) => {
		const answer = answered;
		answered = Promise.resolve();
		await answer;
		stored = pack;
		return packResponse(pack);
	};
	const answerLater = () => {
		const later = Promise.withResolvers<void>();
		answered = later.promise;
		return () => {
			later.resolve();
		};
	};
	const newImage = (extension: string) => {
		imageCount += 1;
		return `00${imageCount}.${extension}`;
	};
	const stickerAt = (index: number, file: string) => {
		const sticker = stored.stickers[index];
		if (sticker?.file !== file) {
			throw new ApiError(404, `${file} is not sticker ${index + 1} in the pack`);
		}
		return sticker;
	};
	api.savePack.mockImplementation(store);
	api.addSticker.mockImplementation(async () => {
		const file = newImage("webp");
		return { ...(await store({ ...stored, stickers: [...stored.stickers, { file }] })), file };
	});
	api.removeSticker.mockImplementation((index, file) => {
		stickerAt(index, file);
		const stickers = stored.stickers.toSpliced(index, 1);
		const cover = stored.cover === file ? (stickers[0]?.file ?? file) : stored.cover;
		return store({ ...stored, cover, stickers });
	});
	api.replaceSticker.mockImplementation((index, file) => {
		const sticker = { ...stickerAt(index, file), file: newImage("png") };
		const cover = stored.cover === file ? sticker.file : stored.cover;
		return store({ ...stored, cover, stickers: stored.stickers.with(index, sticker) });
	});
	api.setCover.mockImplementation((image) =>
		store({ ...stored, cover: image.type === "image/png" ? "cover.png" : "cover.webp" }),
	);
	return { api, encode, editing, answerLater, stored: () => stored };
}

/** Makes `encode` convert the next image when the returned function is called. */
export function convertLater(encode: ReturnType<typeof session>["encode"]): () => void {
	const converted = Promise.withResolvers<Blob>();
	encode.mockReturnValueOnce(converted.promise);
	return () => {
		converted.resolve(new Blob(["png"]));
	};
}
