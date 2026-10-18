import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import ThemeSwitch from "../../src/components/ThemeSwitch.svelte";

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
	delete document.documentElement.dataset.theme;
});

describe("ThemeSwitch", () => {
	it("follows the system when no preference is saved", () => {
		render(ThemeSwitch);

		expect(screen.getByRole("combobox", { name: "Theme" })).toHaveProperty("value", "system");
		expect(document.documentElement.dataset.theme).toBe("system");
	});

	it("restores the saved preference", () => {
		localStorage.setItem("theme", "dark");

		render(ThemeSwitch);

		expect(screen.getByRole("combobox", { name: "Theme" })).toHaveProperty("value", "dark");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it.each([
		["dark", "light"],
		["light", "dark"],
		["system", "dark"],
	])("applies and saves the %s theme", async (theme, previous) => {
		localStorage.setItem("theme", previous);
		render(ThemeSwitch);
		const select = screen.getByRole("combobox", { name: "Theme" });

		await fireEvent.change(select, { target: { value: theme } });

		expect(document.documentElement.dataset.theme).toBe(theme);
		expect(localStorage.getItem("theme")).toBe(theme);
	});

	it("still switches themes when browser storage is blocked", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Storage blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Storage blocked");
		});
		render(ThemeSwitch);

		await fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
			target: { value: "light" },
		});

		expect(document.documentElement.dataset.theme).toBe("light");
	});
});
