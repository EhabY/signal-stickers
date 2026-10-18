import type { ConversionProgress } from "./animationConversion.ts";
import { errorMessage, type Pack } from "./api.ts";
import type { EncodeOptions } from "./stickerImage.ts";

/** An image being converted for the pack, until its result is on its way to the server. */
export type Conversion = Readonly<{
	id: number;
	/** The chosen image's name, or the pack image's when it is converted in place. */
	file: string;
	/** Whether `file` is a pack image being converted in place. */
	inPlace: boolean;
	/** Whether it waits for the images chosen before it. */
	waiting: boolean;
	progress: ConversionProgress | undefined;
}>;

/** What a conversion converts, and when its result no longer has a place in the pack. */
export type ConversionTarget = Readonly<{
	file: string;
	inPlace?: boolean;
	/** Starting this cancels other conversions that replace the cover, so the latest choice wins. */
	replacesCover?: boolean;
	isStale?: (pack: Pack) => boolean;
}>;

/** An image to convert, and where its result goes. */
export type ConversionStep = ConversionTarget &
	Readonly<{
		convert: (options: EncodeOptions) => Promise<Blob>;
		use: (image: Blob) => Promise<void>;
	}>;

/** The images being converted, each of which can be canceled. */
export class Conversions {
	/** In the order they were chosen. */
	list: readonly Conversion[] = $state.raw([]);

	readonly #running = new Map<number, Running>();
	#nextId = 0;
	/** The pack images whose in-place results are on their way to the server. */
	#sending: readonly string[] = $state.raw([]);

	/** The pack images being converted in place, until the server has their results. */
	get inPlace(): string[] {
		const converting = this.list.filter(({ inPlace }) => inPlace).map(({ file }) => file);
		return [...converting, ...this.#sending];
	}

	/**
	 * Converts each step's image in turn and passes it to the step's `use`, listing it until then.
	 * Resolves what failed, by file; a canceled conversion is not a failure.
	 */
	async convertInTurn(
		steps: readonly ConversionStep[],
		onFlattened: (file: string) => void,
	): Promise<string[]> {
		const started = steps.map((step) => ({ step, ...this.#start(step) }));
		const failures: string[] = [];
		for (const { step, id, signal } of started) {
			try {
				// oxlint-disable-next-line no-await-in-loop -- one at a time, and added in the order chosen.
				await this.#convert(step, id, signal, onFlattened);
			} catch (error) {
				if (!signal.aborted) {
					failures.push(`${step.file}: ${errorMessage(error)}`);
				}
			} finally {
				this.#finish(id);
			}
		}
		return failures;
	}

	/** Stops converting an image; a result already on its way to the server still applies. */
	cancel(id: number): void {
		this.#running.get(id)?.controller.abort();
		this.#finish(id);
	}

	cancelAll(): void {
		this.#cancelWhere(() => true);
	}

	/** Cancels the conversions whose result no longer has a place in `pack`. */
	cancelStale(pack: Pack): void {
		this.#cancelWhere(({ isStale }) => isStale?.(pack) === true);
	}

	#start(target: ConversionTarget): Readonly<{ id: number; signal: AbortSignal }> {
		if (target.replacesCover === true) {
			this.#cancelWhere((other) => other.replacesCover === true);
		}
		const id = this.#nextId;
		this.#nextId += 1;
		const controller = new AbortController();
		this.#running.set(id, { target, controller });
		const { file, inPlace = false } = target;
		this.list = [...this.list, { id, file, inPlace, waiting: true, progress: undefined }];
		return { id, signal: controller.signal };
	}

	async #convert(
		step: ConversionStep,
		id: number,
		signal: AbortSignal,
		onFlattened: (file: string) => void,
	): Promise<void> {
		signal.throwIfAborted();
		this.#update(id, { waiting: false });
		const image = await step.convert({
			signal,
			onProgress: (progress) => {
				this.#update(id, { progress });
			},
			onFlattened: () => {
				onFlattened(step.file);
			},
		});
		// Drawing a still image does not watch the signal.
		signal.throwIfAborted();
		this.#finish(id);
		if (step.inPlace !== true) {
			await step.use(image);
			return;
		}
		this.#sending = [...this.#sending, step.file];
		try {
			await step.use(image);
		} finally {
			this.#sending = this.#sending.toSpliced(this.#sending.indexOf(step.file), 1);
		}
	}

	#update(id: number, change: Partial<Conversion>): void {
		this.list = this.list.map((conversion) =>
			conversion.id === id ? { ...conversion, ...change } : conversion,
		);
	}

	/** Stops listing a conversion that ended, or whose result is on its way to the server. */
	#finish(id: number): void {
		if (this.#running.delete(id)) {
			this.list = this.list.filter((conversion) => conversion.id !== id);
		}
	}

	#cancelWhere(matches: (target: ConversionTarget) => boolean): void {
		for (const [id, { target }] of this.#running) {
			if (matches(target)) {
				this.cancel(id);
			}
		}
	}
}

type Running = Readonly<{ target: ConversionTarget; controller: AbortController }>;
