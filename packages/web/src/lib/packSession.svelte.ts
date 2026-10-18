import type { PackResponse } from "@signal-stickers/server/api";

import type { ConversionProgress } from "./animationConversion.ts";
import {
	errorMessage,
	type Api,
	type Pack,
	type StickerLimits,
	type ValidationIssue,
} from "./api.ts";
import type { StickerEncoder } from "./stickerImage.ts";

/** An added image being converted to an animated PNG, and how far along. */
export type Conversion = Readonly<{ file: string; progress: ConversionProgress }>;

const SAVE_DELAY_MS = 300;

/**
 * The working copy being edited. Edits show at once and are saved shortly after, in order. Adding
 * and removing stickers and setting the cover image first save pending edits and set `busy` until
 * the server answers, unless canceled or another pack loads first.
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
	/**
	 * The added animations that became still images because the browser cannot convert them, until
	 * the next add or cover change starts.
	 */
	flattened: readonly string[] = $state.raw([]);
	/** The animation being converted, while an add or cover change converts one. */
	conversion: Conversion | undefined = $state.raw();

	readonly #api: Api;
	readonly #encode: StickerEncoder;
	#unsaved: Pack | undefined;
	#saved: Promise<void> = Promise.resolve();
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#running: AbortController | undefined;

	constructor(api: Api, encode: StickerEncoder) {
		this.#api = api;
		this.#encode = encode;
	}

	/** Shows another pack, canceling a running add, remove, or cover change and ignoring its answer. */
	load(response: PackResponse): void {
		this.cancel();
		this.#running = undefined;
		this.flattened = [];
		this.#show(response);
	}

	/** Stops converting and adding images; a request the server is already handling still shows. */
	cancel(): void {
		this.#running?.abort();
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
		return this.#exclusive(async (signal) => {
			const failures: string[] = [];
			for (const image of images) {
				// oxlint-disable-next-line no-await-in-loop -- the server names each image after the last.
				const failure = await this.#addOne(image, limits, signal);
				if (failure !== undefined) {
					failures.push(failure);
				}
			}
			if (failures.length > 0) {
				throw new Error(failures.join("\n"));
			}
		});
	}

	remove(index: number, file: string): Promise<void> {
		return this.#exclusive(async (signal) => {
			this.#showUnlessReplaced(await this.#api.removeSticker(index, file), signal);
		});
	}

	/** Converts `image` like an added sticker and makes it the separate cover. */
	setCover(image: File, limits: StickerLimits): Promise<void> {
		return this.#exclusive(async (signal) => {
			const cover = await this.#convert(image, limits, signal);
			this.#showUnlessReplaced(await this.#api.setCover(cover), signal);
		});
	}

	#show({ pack, issues }: PackResponse): void {
		clearTimeout(this.#saveTimer);
		this.#unsaved = undefined;
		this.#saved = Promise.resolve();
		this.saveError = undefined;
		this.error = undefined;
		this.pack = pack;
		this.issues = issues;
		this.imageVersion += 1;
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

	async #exclusive(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
		const running = new AbortController();
		this.#running = running;
		this.busy = true;
		this.error = undefined;
		this.flattened = [];
		try {
			await this.save();
			await task(running.signal);
		} catch (error) {
			if (!running.signal.aborted) {
				this.error = errorMessage(error);
			}
		} finally {
			if (this.#running === running) {
				this.#running = undefined;
			}
			this.busy = false;
		}
	}

	async #addOne(
		image: File,
		limits: StickerLimits,
		signal: AbortSignal,
	): Promise<string | undefined> {
		try {
			const sticker = await this.#convert(image, limits, signal);
			this.#showUnlessReplaced(await this.#api.addSticker(sticker), signal);
			return undefined;
		} catch (error) {
			signal.throwIfAborted();
			return `${image.name}: ${errorMessage(error)}`;
		}
	}

	async #convert(image: File, limits: StickerLimits, signal: AbortSignal): Promise<Blob> {
		try {
			const sticker = await this.#encode(image, limits, {
				signal,
				onProgress: (progress) => {
					this.conversion = { file: image.name, progress };
				},
				onFlattened: () => {
					this.flattened = [...this.flattened, image.name];
				},
			});
			// Drawing a still image does not watch the signal.
			signal.throwIfAborted();
			return sticker;
		} finally {
			this.conversion = undefined;
		}
	}

	/** Shows the server's answer to the task that `signal` belongs to, unless another pack loaded. */
	#showUnlessReplaced(response: PackResponse, signal: AbortSignal): void {
		if (this.#running?.signal === signal) {
			this.#show(response);
		}
	}
}

function ignore(): void {}
