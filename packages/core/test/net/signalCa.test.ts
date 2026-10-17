import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SIGNAL_CA } from "../../src/net/signalCa.ts";

describe("SIGNAL_CA", () => {
	it("is Signal's self-signed root CA", () => {
		const ca = new X509Certificate(SIGNAL_CA);

		expect(ca.ca).toBe(true);
		expect(ca.subject).toContain("CN=Signal Messenger");
		expect(ca.verify(ca.publicKey)).toBe(true);
	});
});
