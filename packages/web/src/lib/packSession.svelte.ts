import type { PackResponse, PushResponse } from "@signal-stickers/server/api";

import {
	errorMessage,
	type Api,
	type Pack,
	type StickerLimits,
	type ValidationIssue,
} from "./api.ts";
import { Conversions, type ConversionStep } from "./conversions.svelte.ts";
import { ImageVersions } from "./imageVersions.svelte.ts";
import {
	addSticker,
	removeSticker,
	replaceCover,
	replaceSticker,
	type PackChange,
} from "./packChanges.ts";
import { RequestQueue } from "./requestQueue.svelte.ts";
import type { EncodeOptions, StickerEncoder } from "./stickerImage.ts";

export type { Conversion, ConvertedAnimation } from "./conversions.svelte.ts";

/** A pack image: the sticker at `index`, or the separate cover when `index` is undefined. */
export type PackImageTarget = Readonly<{ file: string; index?: number | undefined }>;

const SAVE_DELAY_MS = 300;

/**
 * The working copy being edited. Edits show at once and are saved shortly after. Every request that
 * changes the pack waits its turn in one queue, so answers apply in order. Images convert while the
 * pack stays editable, and each result applies to the pack as it is when the conversion finishes.
 * Only a pull or push locks editing.
 */
export class PackSession {
	pack: Pack | undefined = $state.raw();
	issues: readonly ValidationIssue[] = $state.raw([]);
	/** Why the last save failed, until one succeeds or a pack loads. */
	saveError: string | undefined = $state();
	/** Why the last changes to the images failed, until the next one starts or a pack loads. */
	error: string | undefined = $state();
	/**
	 * The added animations that became still images because the browser cannot convert them, until
	 * the next change to the images starts.
	 */
	flattened: readonly string[] = $state.raw([]);
	readonly conversions = new Conversions();
	readonly imageVersions = new ImageVersions();

	readonly #api: Api;
	readonly #encode: StickerEncoder;
	readonly #requests = new RequestQueue();
	#unsaved = false;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	/** Changes when another pack loads, so answers about the previous one are ignored. */
	#generation = 0;
	/** Changes whenever the user chooses a cover, so a cover chosen earlier is not used. */
	#coverChoices = 0;
	/** The sticker images replaced in this pack, so a removal clicked before still finds them. */
	readonly #renamed = new Map<string, string>();
	/** The removals not answered yet, so clicking Remove twice spares a sticker sharing the image. */
	readonly #removing = new Set<string>();

	constructor(api: Api, encode: StickerEncoder) {
		this.#api = api;
		this.#encode = encode;
	}

	/** Whether a pull or push is running, which the server does not let edits overlap. */
	get locked(): boolean {
		return this.#requests.locked;
	}

	/** Whether an image is converting or a change to the images is unanswered, so publishing waits. */
	get pending(): boolean {
		return this.conversions.list.length > 0 || this.#requests.changing;
	}

	/** Shows another pack, canceling every conversion and ignoring answers about the previous one. */
	load(response: PackResponse): void {
		this.#generation += 1;
		this.#renamed.clear();
		this.conversions.reset();
		clearTimeout(this.#saveTimer);
		this.#unsaved = false;
		this.saveError = undefined;
		this.error = undefined;
		this.flattened = [];
		this.imageVersions.reset(response.pack);
		this.#show(response);
	}

	/** Imports the pack at `link` in place of this one, with editing locked meanwhile. */
	pull(link: string): Promise<void> {
		return this.#requests.runLocked(async () => {
			this.load(await this.#api.pull(link));
		});
	}

	/** Saves pending edits and publishes the pack, with editing locked meanwhile. */
	publish(): Promise<PushResponse> {
		return this.#requests.runLocked(async () => {
			await this.#flush();
			return this.#api.push();
		});
	}

	edit(pack: Pack): void {
		if (pack.cover !== this.pack?.cover) {
			this.#coverChoices += 1;
		}
		this.#showEdited(pack);
	}

	/** Saves pending edits after the requests before it, retrying a failed save. Rejects if it fails. */
	save(): Promise<void> {
		clearTimeout(this.#saveTimer);
		return this.#requests.run(() => this.#flush());
	}

	/** Converts each image in turn to fit `limits` and appends it; failures are reported per file. */
	add(images: readonly File[], limits: StickerLimits): Promise<void> {
		return this.#convertInTurn(
			images.map((image): ConversionStep => ({
				file: image.name,
				convert: (options) => this.#encode(image, limits, options),
				use: (sticker) => this.#send(addSticker(this.#api, sticker)),
			})),
		);
	}

	/**
	 * Converts each target's image in turn to an animated PNG that fits `limits`, in its place, unless
	 * the target is removed or replaced first; failures are reported per file.
	 */
	convertAnimations(targets: readonly PackImageTarget[], limits: StickerLimits): Promise<void> {
		return this.#convertInTurn(
			targets.map(({ file, index }): ConversionStep => {
				const convert = async (options: EncodeOptions): Promise<Blob> => {
					const stored = await this.#api.getImage(file, options.signal);
					const image = new File([stored], file, { type: stored.type });
					return this.#encode(image, limits, { ...options, mustAnimate: true });
				};
				if (index === undefined) {
					return {
						...this.#coverStep(file, (pack) => pack.cover === file, convert),
						inPlace: true,
					};
				}
				return {
					file,
					inPlace: true,
					isStale: (pack) => !pack.stickers.some((sticker) => sticker.file === file),
					convert,
					use: (apng) => this.#send(replaceSticker(this.#api, index, file, apng)),
				};
			}),
		);
	}

	/** Removes the sticker at `index`, or where its image `file` is by then, unless it is gone. */
	async remove(index: number, file: string): Promise<void> {
		const key = `${index}:${file}`;
		if (this.#removing.has(key)) {
			return;
		}
		this.#removing.add(key);
		this.#startChanging();
		const generation = this.#generation;
		try {
			await this.#send(removeSticker(this.#api, index, file, this.#renamed));
		} catch (error) {
			this.#fail([errorMessage(error)], generation);
		} finally {
			this.#removing.delete(key);
		}
	}

	/** Converts `image` like an added sticker and makes it the separate cover. */
	async setCover(image: File, limits: StickerLimits): Promise<void> {
		this.#coverChoices += 1;
		const choice = this.#coverChoices;
		const convert = (options: EncodeOptions) => this.#encode(image, limits, options);
		await this.#convertInTurn([
			this.#coverStep(image.name, () => choice === this.#coverChoices, convert),
		]);
	}

	async #convertInTurn(steps: readonly ConversionStep[]): Promise<void> {
		this.#startChanging();
		const generation = this.#generation;
		const failures = await this.conversions.convertInTurn(steps, (file) => {
			this.flattened = [...this.flattened, file];
		});
		this.#fail(failures, generation);
	}

	/** A step that makes the converted image the separate cover while `applies` holds. */
	#coverStep(
		file: string,
		applies: (pack: Pack) => boolean,
		convert: ConversionStep["convert"],
	): ConversionStep {
		return {
			file,
			replacesCover: true,
			isStale: (pack) => !applies(pack),
			convert,
			use: (image) => this.#send(replaceCover(this.#api, image, applies)),
		};
	}

	/**
	 * Sends `change` once the requests before it are answered and pending edits are saved, so the
	 * server has the pack as shown. Its answer shows, unless the pack was edited meanwhile; then the
	 * change applies to the edited pack, which is saved. Ignored once another pack loads.
	 */
	#send(change: PackChange): Promise<void> {
		const generation = this.#generation;
		return this.#requests.runChange(async () => {
			if (generation !== this.#generation) {
				return;
			}
			await this.#flush();
			const sent = this.pack;
			const applied = sent && (await change(sent));
			const edited = this.pack;
			if (!applied || generation !== this.#generation) {
				return;
			}
			if (applied.renamed) {
				this.#renamed.set(applied.renamed.from, applied.renamed.to);
			}
			this.imageVersions.renew(applied.written);
			if (edited === sent || !edited) {
				this.#show(applied.answer);
			} else {
				this.#showEdited(applied.merge(edited));
			}
		});
	}

	/** Saves the pack as shown, unless it is saved already, and again if it is edited meanwhile. */
	async #flush(): Promise<void> {
		const pack = this.pack;
		if (!this.#unsaved || !pack) {
			return;
		}
		clearTimeout(this.#saveTimer);
		this.#unsaved = false;
		try {
			const { issues } = await this.#api.savePack(pack);
			this.saveError = undefined;
			if (this.pack === pack) {
				this.issues = issues;
			}
		} catch (error) {
			if (this.pack === pack) {
				this.#unsaved = true;
				this.saveError = `Could not save your changes: ${errorMessage(error)}`;
			}
			throw error;
		}
		await this.#flush();
	}

	#saveSoon(): void {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			this.save().catch(ignore);
		}, SAVE_DELAY_MS);
	}

	/** Shows `pack`, edited by the user or merged with an answer, and saves it soon. */
	#showEdited(pack: Pack): void {
		this.pack = pack;
		this.#unsaved = true;
		this.conversions.cancelStale(pack);
		this.#saveSoon();
	}

	#show({ pack, issues }: PackResponse): void {
		this.pack = pack;
		this.issues = issues;
		this.conversions.cancelStale(pack);
	}

	#startChanging(): void {
		this.error = undefined;
		this.flattened = [];
	}

	#fail(failures: readonly string[], generation: number): void {
		if (failures.length > 0 && generation === this.#generation) {
			this.error = [...(this.error === undefined ? [] : [this.error]), ...failures].join("\n");
		}
	}
}

function ignore(): void {}
