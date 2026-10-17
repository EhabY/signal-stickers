import { describe, expect, it } from "vitest";

import { getChatAuth } from "../../src/account/credentials.ts";
import { CREDENTIALS } from "../support/index.ts";

describe("getChatAuth", () => {
	it("authenticates as aci.deviceId", () => {
		expect(getChatAuth(CREDENTIALS)).toEqual({
			username: `${CREDENTIALS.aci}.2`,
			password: CREDENTIALS.password,
		});
	});
});
