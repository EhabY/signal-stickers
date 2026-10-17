import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vite";

// svelteTesting only applies under Vitest: browser builds of Svelte and DOM cleanup between tests.
export default defineConfig({ plugins: [svelte(), svelteTesting()] });
