import { describe, expect, it } from "vitest";

import { getEnvironmentConfig } from "../src/env.ts";

describe("getEnvironmentConfig", () => {
	it.each([
		["production", "https://chat.signal.org", "https://cdn.signal.org"],
		["staging", "https://chat.staging.signal.org", "https://cdn-staging.signal.org"],
	] as const)("points %s at Signal's hosts", (env, chatUrl, cdnUrl) => {
		expect(getEnvironmentConfig(env)).toEqual({ chatUrl, cdnUrl });
	});
});
