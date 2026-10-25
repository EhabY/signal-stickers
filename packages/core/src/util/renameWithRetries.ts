import { promisify } from "node:util";

import gracefulFs from "graceful-fs";

/** Renames like `fs.rename`, but retries on Windows while another program holds a file open. */
export const renameWithRetries = promisify(gracefulFs.rename);
