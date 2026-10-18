/** Runs requests one at a time in the order queued, whether or not earlier ones failed. */
export class RequestQueue {
	#locks = $state(0);
	#unanswered = $state(0);
	#tail: Promise<unknown> = Promise.resolve();

	/** Whether a request queued with {@link runLocked} has not settled. */
	get locked(): boolean {
		return this.#locks > 0;
	}

	/** Whether a request queued with {@link runChange} has not settled. */
	get changing(): boolean {
		return this.#unanswered > 0;
	}

	/** Runs `task` after every task queued before it. */
	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.#tail.then(task);
		this.#tail = result.catch(ignore);
		return result;
	}

	async runLocked<T>(task: () => Promise<T>): Promise<T> {
		this.#locks += 1;
		try {
			return await this.run(task);
		} finally {
			this.#locks -= 1;
		}
	}

	async runChange(task: () => Promise<void>): Promise<void> {
		this.#unanswered += 1;
		try {
			await this.run(task);
		} finally {
			this.#unanswered -= 1;
		}
	}
}

function ignore(): void {}
