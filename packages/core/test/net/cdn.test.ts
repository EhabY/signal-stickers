import type { ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { getEnvironmentConfig } from "../../src/env.ts";
import { createCdnClient } from "../../src/net/cdn.ts";
import { getBytes } from "../../src/net/http.ts";
import { SIGNAL_CA } from "../../src/net/signalCa.ts";
import { PACK_ID, serveAndRecord, uploadForm, type ReceivedRequest } from "../support/index.ts";

vi.mock(import("../../src/net/http.ts"), async (importOriginal) => ({
	...(await importOriginal()),
	getBytes: vi.fn<typeof getBytes>(() => Promise.resolve(new Uint8Array())),
}));
// Uploads go to a local server whose certificate stands in for Signal's CA, proving pinning.
vi.mock(import("../../src/net/signalCa.ts"), async () => ({
	SIGNAL_CA: (await import("../support/https.ts")).TEST_CA,
}));
vi.mock(import("../../src/env.ts"), async (importOriginal) => {
	const env = await importOriginal();
	return {
		...env,
		getEnvironmentConfig: vi.fn<typeof getEnvironmentConfig>(env.getEnvironmentConfig),
	};
});

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

async function serveCdn(
	respond: (res: ServerResponse) => void = (res) => res.writeHead(204).end(),
) {
	const { origin, requests: posts } = await serveAndRecord(respond);
	vi.mocked(getEnvironmentConfig).mockReturnValueOnce({ chatUrl: origin, cdnUrl: origin });
	return { cdn: createCdnClient({ env: "production" }), origin, posts };
}

/** The boundary of a multipart body, if it has Signal's form: 16 dashes and 32 hex digits. */
function multipartBoundary({ headers }: ReceivedRequest): string | undefined {
	const contentType = headers["content-type"] ?? "";
	return /^multipart\/form-data; boundary=(?<boundary>-{16}[0-9a-f]{32})$/u.exec(contentType)
		?.groups?.boundary;
}

const FORM = uploadForm("stickers/0123/full/0");
const DATA = Uint8Array.of(0, 1, 13, 10, 255);

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

describe("CdnClient.upload", () => {
	it("posts the form to the CDN root laid out like Signal's", async () => {
		const { cdn, posts } = await serveCdn();

		await cdn.upload(FORM, DATA);

		const post = posts[0]!;
		const boundary = multipartBoundary(post);
		const field = (name: string, value: string) =>
			`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
		expect(post).toMatchObject({
			method: "POST",
			url: "/",
			headers: { "user-agent": "signal-stickers" },
		});
		expect(post.body).toEqual(
			Buffer.concat([
				Buffer.from(
					field("key", FORM.key) +
						field("x-amz-credential", FORM.credential) +
						field("acl", FORM.acl) +
						field("x-amz-algorithm", FORM.algorithm) +
						field("x-amz-date", FORM.date) +
						field("policy", FORM.policy) +
						field("x-amz-signature", FORM.signature) +
						field("Content-Type", "application/octet-stream") +
						`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n` +
						"Content-Type: application/octet-stream\r\n\r\n",
				),
				DATA,
				Buffer.from(`\r\n--${boundary}--\r\n`),
			]),
		);
	});

	it("uses a fresh boundary for each upload", async () => {
		const { cdn, posts } = await serveCdn();

		await cdn.upload(FORM, DATA);
		await cdn.upload(FORM, DATA);

		expect(multipartBoundary(posts[0]!)).not.toBe(multipartBoundary(posts[1]!));
	});

	it("reports a rejected upload with its status", async () => {
		const { cdn, origin } = await serveCdn((res) => {
			res.writeHead(403).end();
		});

		const error = await cdn.upload(FORM, DATA).catch(String);

		expect(error).toBe(`HttpError: POST ${origin}/ failed with status 403`);
	});
});
