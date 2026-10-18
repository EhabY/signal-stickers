import type { PackResponse } from "@signal-stickers/server/api";

import type { Api, Pack } from "./api.ts";

/**
 * A change that the server makes to `pack`, the pack it has. Resolves the server's answer and how to
 * make the same change to the pack as edited since, or `undefined` when the change no longer applies.
 */
export type PackChange = (pack: Pack) => Promise<AppliedChange | undefined>;

export type AppliedChange = Readonly<{
	answer: PackResponse;
	merge: (edited: Pack) => Pack;
	/** The sticker image the change replaced, and its replacement. */
	renamed?: Readonly<{ from: string; to: string }>;
}>;

export function addSticker(api: Api, image: Blob): PackChange {
	return async (pack): Promise<AppliedChange | undefined> => {
		const answer = await api.addSticker(image);
		const added = answer.pack.stickers.slice(pack.stickers.length);
		return { answer, merge: (edited) => ({ ...edited, stickers: [...edited.stickers, ...added] }) };
	};
}

/**
 * Removes the sticker at `index` if its image is still `file`, or else the first sticker with that
 * image, following `renamed` to an image that replaced `file`. Does nothing once none has it.
 */
export function removeSticker(
	api: Api,
	index: number,
	file: string,
	renamed: ReadonlyMap<string, string>,
): PackChange {
	return async (pack): Promise<AppliedChange | undefined> => {
		const current = renamed.get(file) ?? file;
		const at = findSticker(pack, index, current);
		if (at === undefined) {
			return undefined;
		}
		const answer = await api.removeSticker(at, current);
		return { answer, merge: (edited) => withoutSticker(edited, at, current) };
	};
}

/**
 * Replaces the image of the sticker at `index` if it is still `file`, or else of the first sticker
 * with that image, unless none has it any more.
 */
export function replaceSticker(api: Api, index: number, file: string, image: Blob): PackChange {
	return async (pack): Promise<AppliedChange | undefined> => {
		const at = findSticker(pack, index, file);
		if (at === undefined) {
			return undefined;
		}
		const answer = await api.replaceSticker(at, file, image);
		const replacement = answer.pack.stickers[at]?.file ?? file;
		return {
			answer,
			merge: (edited) => withImage(edited, at, file, replacement),
			renamed: { from: file, to: replacement },
		};
	};
}

/** Makes `image` the separate cover while `applies` holds for the pack. */
export function replaceCover(api: Api, image: Blob, applies: (pack: Pack) => boolean): PackChange {
	return async (pack): Promise<AppliedChange | undefined> => {
		if (!applies(pack)) {
			return undefined;
		}
		const answer = await api.setCover(image);
		return {
			answer,
			// A cover chosen while the image was sent stays.
			merge: (edited) =>
				edited.cover === pack.cover ? { ...edited, cover: answer.pack.cover } : edited,
		};
	};
}

/** The sticker at `index` if its image is still `file`, or else the first with that image. */
export function findSticker(pack: Pack, index: number, file: string): number | undefined {
	if (pack.stickers[index]?.file === file) {
		return index;
	}
	const found = pack.stickers.findIndex((sticker) => sticker.file === file);
	return found === -1 ? undefined : found;
}

/** Like the server's removal: a cover that only this sticker used becomes the first sticker. */
function withoutSticker(edited: Pack, index: number, file: string): Pack {
	const at = findSticker(edited, index, file);
	if (at === undefined) {
		return edited;
	}
	const stickers = edited.stickers.toSpliced(at, 1);
	const coverRemoved = edited.cover === file && !stickers.some((sticker) => sticker.file === file);
	const cover = coverRemoved ? (stickers[0]?.file ?? edited.cover) : edited.cover;
	return { ...edited, cover, stickers };
}

/** Like the server's replacement: the sticker, and the cover if it was `file`, show `replacement`. */
function withImage(edited: Pack, index: number, file: string, replacement: string): Pack {
	const at = findSticker(edited, index, file);
	const stickers = edited.stickers.map((sticker, i) =>
		i === at ? { ...sticker, file: replacement } : sticker,
	);
	return { ...edited, cover: edited.cover === file ? replacement : edited.cover, stickers };
}
