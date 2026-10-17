import type { ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { getEnvironmentConfig } from "../../src/env.ts";
import { createChatClient, CredentialsRejectedError } from "../../src/net/chat.ts";
import { serveAndRecord } from "../support/index.ts";

// The local server's certificate stands in for Signal's CA, so a request succeeding proves pinning.
vi.mock(import("../../src/net/signalCa.ts"), async () => ({
	SIGNAL_CA: (await import("../support/https.ts")).TEST_CA,
}));
vi.mock(import("../../src/env.ts"), async (importOriginal) => ({
	...(await importOriginal()),
	getEnvironmentConfig: vi.fn<typeof getEnvironmentConfig>(),
}));

const AUTH = { username: "aci.2", password: "hunter2" };

async function chat(respond: (res: ServerResponse) => void) {
	const { origin, requests } = await serveAndRecord(respond);
	vi.mocked(getEnvironmentConfig).mockReturnValue({ chatUrl: origin, cdnUrl: origin });
	return { client: createChatClient({ env: "production", auth: AUTH }), origin, requests };
}

describe("createChatClient", () => {
	it("sends JSON with Basic auth and parses the JSON response", async () => {
		const { client, requests } = await chat((res) => {
			res.end('{"deviceId":2}');
		});

		const response = await client.requestJson({
			method: "PUT",
			path: "/v1/devices/link",
			body: { verificationCode: "code" },
		});

		expect(response).toEqual({ deviceId: 2 });
		expect(requests).toMatchObject([
			{
				method: "PUT",
				url: "/v1/devices/link",
				headers: {
					authorization: `Basic ${Buffer.from("aci.2:hunter2").toString("base64")}`,
					"user-agent": "signal-stickers",
					"content-type": "application/json",
				},
				body: Buffer.from('{"verificationCode":"code"}'),
			},
		]);
	});

	it("sends no body or content type without a body and returns undefined when empty", async () => {
		const { client, requests } = await chat((res) => {
			res.writeHead(204).end();
		});

		expect(await client.requestJson({ method: "DELETE", path: "/v1/devices/2" })).toBeUndefined();
		expect(requests[0]?.headers["content-type"]).toBeUndefined();
		expect(requests[0]?.body).toHaveLength(0);
	});

	it("reports failures with the URL and status but never the password", async () => {
		const { client, origin } = await chat((res) => {
			res.writeHead(500).end();
		});

		const error = await client.requestJson({ method: "GET", path: "/v1/x" }).catch(String);

		expect(error).toBe(`HttpError: GET ${origin}/v1/x failed with status 500`);
	});

	it.each([401, 403])("explains credentials rejected with status %i", async (status) => {
		const { client } = await chat((res) => {
			res.writeHead(status).end();
		});

		const error: unknown = await client
			.requestJson({ method: "GET", path: "/v1/x" })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(CredentialsRejectedError);
		expect(error).toHaveProperty("status", status);
		expect(String(error)).toContain("unlink it and link again");
	});

	it("rejects a response that is not JSON", async () => {
		const { client, origin } = await chat((res) => {
			res.end("<html>");
		});

		const error = await client.requestJson({ method: "GET", path: "/v1/x" }).catch(String);

		expect(error).toBe(`HttpError: GET ${origin}/v1/x returned invalid JSON`);
	});
});
