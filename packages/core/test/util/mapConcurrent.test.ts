import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { mapConcurrent } from "../../src/util/mapConcurrent.ts";

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error("boom"));

describe("mapConcurrent", () => {
	it("keeps order and never exceeds the concurrency", async () => {
		let active = 0;
		let peak = 0;

		const results = await mapConcurrent([3, 1, 2, 0], 2, async (ms) => {
			active += 1;
			peak = Math.max(peak, active);
			await setTimeout(ms);
			active -= 1;
			return ms * 10;
		});

		expect(results).toEqual([30, 10, 20, 0]);
		expect(peak).toBe(2);
	});

	it("stops starting work after a failure", async () => {
		const started: number[] = [];

		const mapping = mapConcurrent([ok, fail, ok, ok], 1, (task, index) => {
			started.push(index);
			return task();
		});

		await expect(mapping).rejects.toThrow("boom");
		expect(started).toEqual([0, 1]);
	});

	it("aborts calls still in flight after a failure", async () => {
		const inFlight = Promise.withResolvers<AbortSignal>();
		const waitForAbort = (signal: AbortSignal) => {
			inFlight.resolve(signal);
			return once(signal, "abort");
		};

		const mapping = mapConcurrent([waitForAbort, fail], 2, (task, _index, signal) => task(signal));

		await expect(mapping).rejects.toThrow("boom");
		expect((await inFlight.promise).aborted).toBe(true);
	});

	it("rejects a concurrency below 1", async () => {
		await expect(mapConcurrent([ok], 0, (task) => task())).rejects.toThrow(RangeError);
	});
});
