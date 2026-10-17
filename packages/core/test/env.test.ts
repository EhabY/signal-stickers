import { describe, expect, it } from "vitest";

import { getEnvironmentConfig, resolveEnvironment, UnknownEnvironmentError } from "../src/env.ts";

describe("getEnvironmentConfig", () => {
	it.each([
		["production", "https://chat.signal.org", "https://cdn.signal.org"],
		["staging", "https://chat.staging.signal.org", "https://cdn-staging.signal.org"],
	] as const)("points %s at Signal's hosts", (env, chatUrl, cdnUrl) => {
		expect(getEnvironmentConfig(env)).toEqual({ chatUrl, cdnUrl });
	});
});

describe("resolveEnvironment", () => {
	it.each([
		["nothing", undefined, {}, "production"],
		["an empty variable", undefined, { SIGNAL_STICKERS_ENV: "" }, "production"],
		["the variable", undefined, { SIGNAL_STICKERS_ENV: "staging" }, "staging"],
		["the flag over the variable", true, { SIGNAL_STICKERS_ENV: "production" }, "staging"],
	] as const)("picks the environment from %s", (_, staging, variables, env) => {
		expect(resolveEnvironment(staging, variables)).toBe(env);
	});

	it("rejects an unknown SIGNAL_STICKERS_ENV", () => {
		expect(() => resolveEnvironment(undefined, { SIGNAL_STICKERS_ENV: "dev" })).toThrow(
			new UnknownEnvironmentError("SIGNAL_STICKERS_ENV must be one of: production, staging"),
		);
	});
});
