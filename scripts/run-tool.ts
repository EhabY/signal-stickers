import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { styleText } from "node:util";

// Oxc defaults to one thread per core, but beyond about 8 the per-thread
// startup cost outweighs the gain.
const OXC_MAX_THREADS = 8;

const [tool, ...args] = process.argv.slice(2);
if (tool !== "oxlint" && tool !== "oxfmt") {
	throw new Error("Usage: node scripts/run-tool.ts <oxlint|oxfmt> [args...]");
}
args.push("--threads", String(Math.min(availableParallelism(), OXC_MAX_THREADS)));

// Run the bin script with Node: the .bin shims need a shell on Windows.
const packageDir = dirname(createRequire(import.meta.url).resolve(`${tool}/package.json`));

const start = performance.now();
const { status, error } = spawnSync(process.execPath, [join(packageDir, "bin", tool), ...args], {
	stdio: "inherit",
});
if (error) {
	throw error;
}
const ms = performance.now() - start;
const elapsed = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
console.log(styleText("dim", `⏱ ${tool} finished in ${elapsed}`));
process.exit(status ?? 1);
