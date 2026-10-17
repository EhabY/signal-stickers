import type { PackResponse } from "@signal-stickers/server/api";

import {
	errorMessage,
	type Api,
	type Pack,
	type StickerLimits,
	type ValidationIssue,
} from "./api.ts";
import type { StickerEncoder } from "./stickerImage.ts";

const SAVE_DELAY_MS = 300;

/**
 * The working copy being edited. Edits show at once and are saved shortly after, in order. Adding
 * and removing stickers and setting the cover image first save pending edits and set `busy` until
 * the server answers.
 */
export class PackSession {
	pack: Pack | undefined = $state.raw();
	issues: readonly ValidationIssue[] = $state.raw([]);
	/** Changes whenever images may have changed, so thumbnails reload. */
	imageVersion = $state(0);
	busy = $state(false);
	/** Why the last save failed, until one succeeds or a pack loads. */
	saveError: string | undefined = $state();
	/** Why the last add, remove, or cover change failed, until the next one starts or a pack loads. */
	error: string | undefined = $state();

	readonly #api: Api;
	readonly #encode: StickerEncoder;
	#unsaved: Pack | undefined;
	#saved: Promise<void> = Promise.resolve();
	#saveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(api: Api, encode: StickerEncoder) {
		this.#api = api;
		this.#encode = encode;
	}

	load({ pack, issues }: PackResponse): void {
		clearTimeout(this.#saveTimer);
		this.#unsaved = undefined;
		this.#saved = Promise.resolve();
		this.saveError = undefined;
		this.error = undefined;
		this.pack = pack;
		this.issues = issues;
		this.imageVersion += 1;
	}

	edit(pack: Pack): void {
		this.pack = pack;
		this.#unsaved = pack;
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.save().catch(ignore);
		}, SAVE_DELAY_MS);
	}

	/** Saves pending edits now, retrying a failed save. Rejects if the latest save failed. */
	save(): Promise<void> {
		clearTimeout(this.#saveTimer);
		const pack = this.#unsaved;
		this.#unsaved = undefined;
		if (pack) {
			this.#saved = this.#saved.catch(ignore).then(() => this.#put(pack));
		}
		return this.#saved;
	}

	/** Converts each image to fit `limits` and appends it; failures are reported per file. */
	add(images: readonly File[], limits: StickerLimits): Promise<void> {
		return this.#exclusive(async () => {
			const failures: string[] = [];
			for (const image of images) {
				// oxlint-disable-next-line no-await-in-loop -- the server names each image after the last.
				const failure = await this.#addOne(image, limits);
				if (failure !== undefined) {
					failures.push(failure);
				}
			}
			if (failures.length > 0) {
				throw new Error(failures.join("\n"));
			}
		});
	}

	remove(file: string): Promise<void> {
		return this.#exclusive(async () => {
			this.load(await this.#api.removeSticker(file));
		});
	}

	/** Converts `image` like an added sticker and makes it the separate cover. */
	setCover(image: File, limits: StickerLimits): Promise<void> {
		return this.#exclusive(async () => {
			this.load(await this.#api.setCover(await this.#encode(image, limits)));
		});
	}

	async #put(pack: Pack): Promise<void> {
		try {
			const { issues } = await this.#api.savePack(pack);
			this.saveError = undefined;
			if (this.pack === pack) {
				this.issues = issues;
			}
		} catch (error) {
			if (this.pack === pack) {
				this.#unsaved = pack;
				this.saveError = `Could not save your changes: ${errorMessage(error)}`;
			}
			throw error;
		}
	}

	async #exclusive(task: () => Promise<void>): Promise<void> {
		this.busy = true;
		this.error = undefined;
		try {
			await this.save();
			await task();
		} catch (error) {
			this.error = errorMessage(error);
		} finally {
			this.busy = false;
		}
	}

	async #addOne(image: File, limits: StickerLimits): Promise<string | undefined> {
		try {
			const sticker = await this.#encode(image, limits);
			this.load(await this.#api.addSticker(sticker));
			return undefined;
		} catch (error) {
			return `${image.name}: ${errorMessage(error)}`;
		}
	}
}

function ignore(): void {}
