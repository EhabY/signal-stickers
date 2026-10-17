import { globSync, rmSync } from "node:fs";

// Generated files to delete, as paths or globs from the repo root.
const PATTERNS = [
	"node_modules",
	"packages/*/node_modules",
	"packages/*/dist",
	"packages/*/.svelte-check",
	"coverage",
	".pnpm-store",
	"*.log",
];

for (const path of globSync(PATTERNS)) {
	rmSync(path, { recursive: true, force: true });
}
