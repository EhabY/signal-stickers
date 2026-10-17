import { defineConfig } from "vitest/config";

// NTFS is slow with many small-file writes; double the default on Windows.
const testTimeout = process.platform === "win32" ? 10_000 : 5_000;
const include = ["test/**/*.test.ts"];

export default defineConfig({
	test: {
		testTimeout,
		clearMocks: true,
		projects: [
			...["core", "cli", "server"].map((name) => ({
				extends: true,
				test: { name, root: `packages/${name}`, include, environment: "node" },
			})),
			// Extends web's Vite config for the Svelte plugins, so the root options are repeated here.
			{
				extends: "./packages/web/vite.config.ts",
				test: {
					name: "web",
					root: "packages/web",
					include,
					environment: "jsdom",
					testTimeout,
					clearMocks: true,
				},
			},
		],
		coverage: { provider: "v8", include: ["packages/*/src/**/*.{ts,svelte}"] },
	},
});
