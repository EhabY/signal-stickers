import * as esbuild from "esbuild";

const options: esbuild.BuildOptions = {
	entryPoints: ["src/main.ts"],
	outfile: "dist/signal-stickers-cli.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	sourcemap: true,
	// Native addons cannot be bundled and must be resolved at runtime.
	external: ["@signalapp/libsignal-client"],
	// Bundled CommonJS dependencies (qrcode) require Node built-ins, which an ES module lacks.
	banner: {
		js: [
			"#!/usr/bin/env node",
			'import { createRequire } from "node:module";',
			"const require = createRequire(import.meta.url);",
		].join("\n"),
	},
	// Only `pnpm pull` from source should resolve paths against INIT_CWD; see src/main.ts.
	define: { "process.env.INIT_CWD": "undefined" },
	logLevel: "info",
};

if (process.argv.includes("--watch")) {
	await (await esbuild.context(options)).watch();
} else {
	await esbuild.build(options);
}
