import type { Pack } from "./api.ts";

/**
 * Each image file's version, for thumbnail URLs: it changes whenever the file may hold another
 * image, so only that thumbnail reloads.
 */
export class ImageVersions {
	#versions: ReadonlyMap<string, number> = $state.raw(new Map());
	#last = 0;

	get(file: string): number {
		return this.#versions.get(file) ?? 0;
	}

	/** Gives each of `pack`'s images a new version and forgets every other, as when a pack loads. */
	reset({ cover, stickers }: Pack): void {
		this.#versions = new Map();
		this.renew([cover, ...stickers.map(({ file }) => file)]);
	}

	/** Gives each of `files` a new version, since it may hold another image now. */
	renew(files: readonly string[]): void {
		const versions = new Map(this.#versions);
		for (const file of files) {
			this.#last += 1;
			versions.set(file, this.#last);
		}
		this.#versions = versions;
	}
}
