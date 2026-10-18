import { ApiError } from "./errors.ts";

export type Operation = "link" | "unlink" | "pull" | "push";

export type Operations = Readonly<{
	/** Runs `task` unless another operation is running, which is a 409. */
	exclusive<T>(operation: Operation, task: () => Promise<T>): Promise<T>;
	/** Edits wait in the working copy's queue, but must not wait minutes for a pull or push. */
	assertEditable(): void;
}>;

export function createOperations(): Operations {
	let running: Operation | undefined;
	const busy = (operation: Operation) => new ApiError(409, `Wait for the ${operation} to finish`);
	return {
		exclusive: async (operation, task) => {
			if (running) {
				throw busy(running);
			}
			running = operation;
			try {
				return await task();
			} finally {
				running = undefined;
			}
		},
		assertEditable: () => {
			if (running === "pull" || running === "push") {
				throw busy(running);
			}
		},
	};
}
