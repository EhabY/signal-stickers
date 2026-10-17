import * as esbuild from "esbuild";

const options: esbuild.BuildOptions = {
	entryPoints: ["src/main.ts"],
	outfile: "dist/signal-stickers.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	sourcemap: true,
	// Native addons cannot be bundled and must be resolved at runtime.
	external: ["@signalapp/libsignal-client"],
	banner: { js: "#!/usr/bin/env node" },
	// Only `pnpm pull` from source should resolve paths against INIT_CWD; see src/main.ts.
	define: { "process.env.INIT_CWD": "undefined" },
	logLevel: "info",
};

if (process.argv.includes("--watch")) {
	await (await esbuild.context(options)).watch();
} else {
	await esbuild.build(options);
}
