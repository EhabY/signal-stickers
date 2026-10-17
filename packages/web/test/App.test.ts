import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import App from "../src/App.svelte";

describe("App", () => {
	it("renders the title", () => {
		render(App);

		expect(screen.getByRole("heading").textContent).toBe("Signal Stickers");
	});
});
