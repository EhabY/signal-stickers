import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vite";

// The server's `dev` script listens on this port and accepts http://localhost:5173 as an origin.
// changeOrigin sends the server its own Host, which it requires.
const API_URL = "http://127.0.0.1:5174";

// svelteTesting only applies under Vitest: browser builds of Svelte and DOM cleanup between tests.
export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	server: {
		port: 5173,
		strictPort: true,
		// Like the server, forbid other sites to frame the app and trick the user into clicking.
		headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
		proxy: { "/api": { target: API_URL, ws: true, changeOrigin: true } },
	},
});
