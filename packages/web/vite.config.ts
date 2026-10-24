import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig, type Plugin } from "vite";

// The server's `dev` script listens on this port and accepts http://localhost:5173 as an origin.
// changeOrigin sends the server its own Host, which it requires.
const API_URL = "http://127.0.0.1:5174";

// upng-js takes the bundled pako only if `typeof require` is "function", which bundling leaves for
// the browser to evaluate, where it is not; it then reads `window.pako`, which a worker lacks.
const UPNG_REQUIRE_CHECK = 'typeof require == "function"';
const upngWithBundledPako: Plugin = {
	name: "upng-with-bundled-pako",
	transform: {
		filter: { id: /[\\/]upng-js[\\/]UPNG\.js$/u },
		handler: (code) => {
			if (!code.includes(UPNG_REQUIRE_CHECK)) {
				throw new Error(`upng-js no longer contains ${UPNG_REQUIRE_CHECK}`);
			}
			return code.replace(UPNG_REQUIRE_CHECK, "true");
		},
	},
};

// svelteTesting only applies under Vitest: browser builds of Svelte and DOM cleanup between tests.
// Workers and pre-bundled dependencies take their own plugins. The dependency scan misses imports
// from workers, so their dependencies are pre-bundled up front rather than reloading the page on
// first use.
export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	worker: { plugins: () => [upngWithBundledPako] },
	optimizeDeps: {
		include: ["apng-js", "gifuct-js", "upng-js"],
		rolldownOptions: { plugins: [upngWithBundledPako] },
	},
	server: {
		port: 5173,
		strictPort: true,
		// Like the server, forbid other sites to frame the app and trick the user into clicking.
		headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
		proxy: { "/api": { target: API_URL, ws: true, changeOrigin: true } },
	},
});
