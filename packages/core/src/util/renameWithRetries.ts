import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/**
 * Renames like `fs.rename`, but on Windows retries for a few seconds while another program, such as
 * an antivirus scanner, holds a file open and so blocks the move.
 */
export function renameWithRetries(
	from: string,
	to: string,
	{ platform = process.platform }: { platform?: NodeJS.Platform } = {},
): Promise<void> {
	const attempt = async (count: number): Promise<void> => {
		try {
			await rename(from, to);
		} catch (error) {
			if (platform !== "win32" || count === ATTEMPTS || !isBusy(error)) {
				throw error;
			}
			await setTimeout(count * 100);
			await attempt(count + 1);
		}
	};
	return attempt(1);
}

const ATTEMPTS = 10;
const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function isBusy(error: unknown): boolean {
	return error instanceof Error && "code" in error && BUSY_CODES.has(String(error.code));
}
