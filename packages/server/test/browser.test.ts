import { describe, expect, it } from "vitest";

import { browserCommand } from "../src/browser.ts";

const ADDRESS = "http://127.0.0.1:1234";

describe("browserCommand", () => {
	it.each([
		["win32", ["cmd", ["/c", "start", "", ADDRESS]]],
		["darwin", ["open", [ADDRESS]]],
		["linux", ["xdg-open", [ADDRESS]]],
		["freebsd", ["xdg-open", [ADDRESS]]],
	] as const)("opens the default browser on %s", (platform, command) => {
		expect(browserCommand(platform, ADDRESS)).toEqual(command);
	});
});
