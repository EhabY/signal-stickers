export type PackSticker = {
	/** Image file name inside the pack folder. */
	file: string;
	emoji?: string;
};

/** The `pack.json` describing a pack folder. */
export type Pack = {
	title: string;
	author: string;
	/** Image file name of the cover, either a sticker's or a separate one. */
	cover: string;
	stickers: PackSticker[];
};

/**
 * `pack` without the sticker at `index`. A cover that only that sticker used becomes the first
 * sticker's image.
 */
export function removeStickerAt(pack: Pack, index: number): Pack {
	const file = pack.stickers[index]?.file;
	const stickers = pack.stickers.toSpliced(index, 1);
	const [first] = stickers;
	const coverRemoved = pack.cover === file && !stickers.some((sticker) => sticker.file === file);
	return { ...pack, cover: coverRemoved && first ? first.file : pack.cover, stickers };
}

/** `pack` with `replacement` as the image of the sticker at `index`, and of the cover if it shared it. */
export function replaceStickerImage(pack: Pack, index: number, replacement: string): Pack {
	const sticker = pack.stickers[index];
	if (!sticker) {
		return pack;
	}
	return {
		...pack,
		cover: pack.cover === sticker.file ? replacement : pack.cover,
		stickers: pack.stickers.with(index, { ...sticker, file: replacement }),
	};
}
