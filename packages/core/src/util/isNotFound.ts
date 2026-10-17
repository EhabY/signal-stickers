/** Whether a file system call failed because the path does not exist. */
export function isNotFound(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** A `catch` handler that turns a missing path into `undefined` and rethrows anything else. */
export function ignoreNotFound(error: unknown): undefined {
	if (isNotFound(error)) {
		return undefined;
	}
	throw error;
}
