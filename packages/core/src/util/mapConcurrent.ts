/**
 * Like `Promise.all(items.map(fn))` with at most `concurrency` calls in flight. The signal passed to
 * `fn` aborts when `signal` does or when any call rejects, and no new calls start after that.
 * Waits for in-flight calls to settle before rejecting, so callers can safely clean up.
 */
export async function mapConcurrent<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
	signal?: AbortSignal,
): Promise<R[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new RangeError(`Concurrency must be a positive integer: ${concurrency}`);
	}
	const failure = new AbortController();
	const stop = signal ? AbortSignal.any([signal, failure.signal]) : failure.signal;
	const results: R[] = [];
	const entries = items.entries();
	const worker = async () => {
		for (const [index, item] of entries) {
			stop.throwIfAborted();
			try {
				// oxlint-disable-next-line no-await-in-loop -- each worker runs its items one at a time.
				results[index] = await fn(item, index, stop);
			} catch (error) {
				failure.abort(error);
				throw error;
			}
		}
	};
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
	try {
		await Promise.all(workers);
	} catch (error) {
		await Promise.allSettled(workers);
		throw error;
	}
	return results;
}
