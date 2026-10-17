import { describe, expect, it } from "vitest";

import { HOST } from "../src/index.ts";

describe("HOST", () => {
	it("is loopback only", () => {
		expect(HOST).toBe("127.0.0.1");
	});
});
