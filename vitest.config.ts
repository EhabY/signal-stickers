import { defineConfig } from "vitest/config";

// NTFS is slow with many small-file writes; double the default on Windows.
const testTimeout = process.platform === "win32" ? 10_000 : 5_000;

export default defineConfig({
	test: {
		testTimeout,
		clearMocks: true,
		projects: ["core", "cli"].map((name) => ({
			extends: true,
			test: { name, root: `packages/${name}`, include: ["test/**/*.test.ts"], environment: "node" },
		})),
		coverage: { provider: "v8", include: ["packages/*/src/**/*.ts"] },
	},
});
