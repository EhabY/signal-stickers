import { describe, expect, it, vi } from "vitest";

import { createCdnClient } from "../../src/net/cdn.ts";
import { getBytes } from "../../src/net/http.ts";
import { SIGNAL_CA } from "../../src/net/signalCa.ts";
import { PACK_ID } from "../support/index.ts";

vi.mock(import("../../src/net/http.ts"), async (importOriginal) => ({
	...(await importOriginal()),
	getBytes: vi.fn<typeof getBytes>(() => Promise.resolve(new Uint8Array())),
}));

function requests() {
	return vi
		.mocked(getBytes)
		.mock.calls.map(([url, { ca, headers, redactedUrl }]) => ({
			url,
			redactedUrl,
			pinned: ca === SIGNAL_CA,
			userAgent: headers["User-Agent"],
		}));
}

describe("createCdnClient", () => {
	it.each([
		["production", "https://cdn.signal.org"],
		["staging", "https://cdn-staging.signal.org"],
	] as const)("fetches %s manifests and stickers with the pinned CA", async (env, host) => {
		const cdn = createCdnClient({ env });

		await cdn.getManifest(PACK_ID);
		await cdn.getSticker(PACK_ID, 7);

		const stickers = `${host}/stickers`;
		expect(requests()).toEqual([
			{
				url: `${stickers}/${PACK_ID}/manifest.proto`,
				redactedUrl: `${stickers}/[REDACTED]ccf/manifest.proto`,
				pinned: true,
				userAgent: "signal-stickers",
			},
			{
				url: `${stickers}/${PACK_ID}/full/7`,
				redactedUrl: `${stickers}/[REDACTED]ccf/full/7`,
				pinned: true,
				userAgent: "signal-stickers",
			},
		]);
	});

	it("rejects invalid pack ids without a request", async () => {
		const cdn = createCdnClient({ env: "production" });

		await expect(cdn.getManifest("../../v1/accounts")).rejects.toThrow(TypeError);
		expect(requests()).toEqual([]);
	});
});
