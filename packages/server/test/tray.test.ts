import { join } from "node:path";
import { setImmediate } from "node:timers/promises";

import { tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it, vi } from "vitest";

import { showTray } from "../src/tray.ts";

/** Node arguments for a helper that makes each choice, then waits for stdin to close like the real one. */
function fakeHelper(...choices: string[]): string[] {
	const script = choices.map((choice) => `console.log("${choice}");`).join("");
	return ["-e", `${script} process.stdin.resume();`];
}

describe("showTray", () => {
	it("reports each choice from the tray", async () => {
		const open = vi.fn<() => void>();
		const quit = vi.fn<() => void>();

		const close = showTray(process.execPath, fakeHelper("open", "quit"), { open, quit });

		await vi.waitFor(() => {
			expect(quit).toHaveBeenCalledOnce();
		});
		expect(open).toHaveBeenCalledOnce();
		close();
	});

	it("goes on without a tray when the helper cannot run", async () => {
		const helper = join(await tempDir(), "missing");

		const close = showTray(helper, [], { open: vi.fn<() => void>(), quit: vi.fn<() => void>() });
		await setImmediate();

		expect(close).not.toThrow();
	});
});
