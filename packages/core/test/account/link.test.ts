import { describe, expect, it } from "vitest";

import { getLinkStatus } from "../../src/account/link.ts";
import { CREDENTIALS } from "../support/index.ts";

describe("getLinkStatus", () => {
	it("describes linked credentials without the password", () => {
		const status = getLinkStatus({ ...CREDENTIALS, number: "+15555550123" });

		expect(status).toEqual({
			linked: true,
			env: "production",
			aci: CREDENTIALS.aci,
			deviceId: 2,
			number: "+15555550123",
			createdAt: CREDENTIALS.createdAt,
		});
	});

	it("reports no credentials as unlinked", () => {
		expect(getLinkStatus()).toEqual({ linked: false });
	});
});
