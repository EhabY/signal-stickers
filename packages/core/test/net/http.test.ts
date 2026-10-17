import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import tls from "node:tls";

import { describe, expect, it, onTestFinished } from "vitest";

import { getBytes, HttpError, request, type GetBytesOptions } from "../../src/net/http.ts";
import { SIGNAL_CA } from "../../src/net/signalCa.ts";
import { serveAndRecord, serveHttps, TEST_CA, type HttpsHandler } from "../support/index.ts";

const ok: HttpsHandler = (_, res) => {
	res.end("ok");
};
const hang: HttpsHandler = () => {};
const partial: HttpsHandler = (_, res) => {
	res.writeHead(200, { "Content-Length": 10 }).write("abc");
};

async function serve(handler: HttpsHandler): Promise<string> {
	return `${await serveHttps(handler)}/secret`;
}

/** A loopback port that nothing listens on. */
async function closedPort(): Promise<number> {
	const server = createNetServer();
	await once(server.listen(0, "127.0.0.1"), "listening");
	const address = server.address();
	server.close();
	if (typeof address !== "object" || !address) {
		throw new Error("Server has no address");
	}
	return address.port;
}

const OPTIONS: GetBytesOptions = {
	ca: TEST_CA,
	headers: { "User-Agent": "test" },
	maxBytes: 16,
	timeoutMs: 5_000,
	redactedUrl: "https://example/[REDACTED]",
};

function get(url: string, options: Partial<GetBytesOptions> = {}) {
	return getBytes(url, { ...OPTIONS, ...options });
}

describe("getBytes", () => {
	it("returns the body from a server signed by the pinned CA", async () => {
		const url = await serve((req, res) => {
			res.end(req.headers["user-agent"]);
		});

		expect(Buffer.from(await get(url)).toString()).toBe("test");
	});

	it("trusts only the pinned CA, not the default root store", async () => {
		const defaults = tls.getCACertificates("default");
		tls.setDefaultCACertificates([...defaults, TEST_CA]);
		onTestFinished(() => {
			tls.setDefaultCACertificates(defaults);
		});
		const url = await serve(ok);

		await expect(get(url, { ca: SIGNAL_CA })).rejects.toMatchObject({
			name: "HttpError",
			cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
		});
	});

	it("throws HttpError with the redacted URL on other statuses", async () => {
		const url = await serve((_, res) => {
			res.writeHead(404).end();
		});

		await expect(get(url)).rejects.toMatchObject({
			name: "HttpError",
			status: 404,
			message: "GET https://example/[REDACTED] failed with status 404",
		});
	});

	it.each([
		["declared", (body: string) => ({ "Content-Length": body.length })],
		["streamed", () => ({})],
	])("rejects %s bodies over maxBytes", async (_label, headers) => {
		const body = "x".repeat(17);
		const url = await serve((_, res) => {
			res.writeHead(200, headers(body)).end(body);
		});

		await expect(get(url)).rejects.toThrow("GET https://example/[REDACTED] exceeded 16 bytes");
	});

	it("rejects a body that is cut off", async () => {
		const url = await serve((_, res) => {
			res.writeHead(200, { "Content-Length": 10 }).write("abc", () => {
				res.destroy();
			});
		});

		await expect(get(url)).rejects.toThrow(HttpError);
	});

	it("names every refused address when the connection fails", async () => {
		const port = await closedPort();

		await expect(get(`https://localhost:${port}/`)).rejects.toThrow(/failed: .*ECONNREFUSED/u);
	});

	it.each([
		["waiting for a response", hang],
		["reading the body", partial],
	])("times out while %s", async (_label, listener) => {
		const url = await serve(listener);

		await expect(get(url, { timeoutMs: 100 })).rejects.toThrow(
			"GET https://example/[REDACTED] timed out after 100ms",
		);
	});

	it.each([
		["before the request", () => AbortSignal.abort(), "AbortError"],
		["while reading the body", () => AbortSignal.timeout(50), "TimeoutError"],
	])("rejects with the caller's reason when aborted %s", async (_label, signal, name) => {
		const url = await serve(partial);

		await expect(get(url, { signal: signal() })).rejects.toThrow(expect.objectContaining({ name }));
	});
});

describe("request", () => {
	it("sends the method and the body with its length", async () => {
		const { origin, requests } = await serveAndRecord((res) => {
			res.writeHead(201).end("created");
		});

		const response = await request(origin, { ...OPTIONS, method: "PUT", body: "héllo" });

		expect(Buffer.from(response).toString()).toBe("created");
		expect(requests).toMatchObject([
			{ method: "PUT", headers: { "content-length": "6" }, body: Buffer.from("héllo") },
		]);
	});

	it("returns an empty body for 204", async () => {
		const url = await serve((_, res) => {
			res.writeHead(204).end();
		});

		expect(await request(url, { ...OPTIONS, method: "DELETE" })).toHaveLength(0);
	});

	it("names the method when the status is not 2xx", async () => {
		const url = await serve((_, res) => {
			res.writeHead(302, { Location: "https://example.com" }).end();
		});

		await expect(request(url, { ...OPTIONS, method: "POST", body: "x" })).rejects.toMatchObject({
			status: 302,
			message: "POST https://example/[REDACTED] failed with status 302",
		});
	});
});
