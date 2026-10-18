import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { FitAttempt } from "../../src/lib/apng.ts";
import { Conversions, type ConversionStep } from "../../src/lib/conversions.svelte.ts";

const ENCODING: FitAttempt = { size: 320, colors: 256, frames: 60, fps: 20 };

/** A step that converts `file` to `bytes`, as an animated PNG if `encoding` is set. */
function step(file: string, bytes: number, encoding?: FitAttempt): ConversionStep {
	return {
		file,
		convert: ({ onAnimated }) => {
			if (encoding) {
				onAnimated?.(encoding);
			}
			return Promise.resolve(new Blob([new Uint8Array(bytes)]));
		},
		use: () => Promise.resolve(),
	};
}

describe("Conversions", () => {
	it("lists what each animation became for a few seconds, but not still images", async () => {
		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const conversions = new Conversions();

		await conversions.convertInTurn(
			[step("cat.gif", 2048, ENCODING), step("photo.jpg", 1024)],
			vi.fn<() => void>(),
		);
		const listed = conversions.converted;
		vi.advanceTimersByTime(6000);

		expect(listed).toMatchObject([{ file: "cat.gif", size: 320, fps: 20, bytes: 2048 }]);
		expect(conversions.converted).toEqual([]);
	});

	it("lists nothing for an animation the pack did not take", async () => {
		const conversions = new Conversions();
		const refused = new Error("the server refused it");
		const cat = { ...step("cat.gif", 2048, ENCODING), use: () => Promise.reject(refused) };

		const failures = await conversions.convertInTurn([cat], vi.fn<() => void>());

		expect(failures).toEqual(["cat.gif: the server refused it"]);
		expect(conversions.converted).toEqual([]);
	});
});
