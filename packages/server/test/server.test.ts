import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { tempDir } from "@signal-stickers/core/testing";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { HOST } from "../src/index.ts";
import { blockUntilAborted, rawRequest, serve, startRequest } from "./support.ts";

const EVIL = "https://evil.example";

/** Serves a built web UI with an index page and one script. */
async function serveWeb() {
	const webDir = await tempDir();
	await mkdir(join(webDir, "assets"));
	await writeFile(join(webDir, "index.html"), "<!doctype html>");
	await writeFile(join(webDir, "assets", "app.js"), "export {};");
	return serve({ webDir });
}

describe("startServer", () => {
	it("listens on loopback only", async () => {
		const server = await serve();

		expect(HOST).toBe("127.0.0.1");
		expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
	});

	it.each(["evil.example", "127.0.0.1:1"])(
		"rejects the Host %s against DNS rebinding",
		async (host) => {
			const server = await serve();

			expect(await rawRequest(server.url, { headers: { host } })).toBe(403);
		},
	);

	it("accepts localhost as the Host", async () => {
		const server = await serve();
		const { port } = new URL(server.url);

		expect(await rawRequest(server.url, { headers: { host: `localhost:${port}` } })).toBe(200);
	});

	it("refuses requests from other sites before running them", async () => {
		const unlinkDevice = vi.fn<() => Promise<void>>();
		const server = await serve({ deps: { unlinkDevice } });

		const status = await rawRequest(server.url, {
			method: "POST",
			path: "/api/unlink",
			headers: { origin: EVIL },
		});

		expect(status).toBe(403);
		expect(unlinkDevice).not.toHaveBeenCalled();
	});

	it.each([
		["its own origin", (url: string) => url],
		["an allowed origin", () => "http://localhost:5173"],
	])("accepts requests from %s", async (_, origin) => {
		const server = await serve({ allowedOrigins: ["http://localhost:5173"] });

		const status = await rawRequest(server.url, {
			method: "POST",
			path: "/api/unlink",
			headers: { origin: origin(server.url) },
		});

		expect(status).toBe(200);
	});

	it.each([
		["from another site", "/api/events", () => EVIL, 403],
		["on another path", "/api/other", (url: string) => url, 404],
	])("refuses WebSockets %s", async (_, path, origin, status) => {
		const server = await serve();
		const socket = new WebSocket(`${server.url.replace("http", "ws")}${path}`, {
			origin: origin(server.url),
		});

		const error = await new Promise((resolve) => {
			socket.once("error", resolve);
		});

		expect(error).toMatchObject({ message: `Unexpected server response: ${status}` });
	});

	it.each(["//[", "http://["])("answers 400 to %s and keeps running", async (path) => {
		const server = await serve();

		expect(await rawRequest(server.url, { path })).toBe(400);
		expect(await rawRequest(server.url, {})).toBe(200);
	});

	it("answers unknown API routes with a JSON 404", async () => {
		const server = await serve();

		expect(await server.send("PATCH", "/api/pack")).toEqual({
			status: 404,
			body: { error: "Not found" },
		});
	});

	it("cancels an operation when its client disconnects", async () => {
		const { started, operation } = blockUntilAborted();
		const server = await serve({ deps: { linkDevice: operation } });
		const request = startRequest(server, "POST", "/api/link");
		const signal = await started;

		request.cancel();

		await vi.waitFor(() => {
			expect(signal.aborted).toBe(true);
		});
		expect(await server.send("POST", "/api/unlink")).toMatchObject({ status: 200 });
	});

	it("cancels running operations when it closes", async () => {
		const { started, operation } = blockUntilAborted();
		const server = await serve({ deps: { linkDevice: operation } });
		const request = startRequest(server, "POST", "/api/link");
		const signal = await started;

		await server.close();

		expect(signal.aborted).toBe(true);
		expect(await request.response).toBeInstanceOf(Error);
	});
});

describe("web UI", () => {
	it.each([
		["/", "text/html; charset=utf-8", "<!doctype html>"],
		["/assets/app.js", "text/javascript; charset=utf-8", "export {};"],
	])("serves %s", async (path, type, text) => {
		const server = await serveWeb();

		const response = await fetch(`${server.url}${path}`);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(type);
		expect(await response.text()).toBe(text);
	});

	it.each(["/missing.js", "/assets", "/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/%E0%A4%A"])(
		"answers 404 for %s",
		async (path) => {
			const server = await serveWeb();

			expect(await rawRequest(server.url, { path })).toBe(404);
		},
	);

	it("forbids other sites to frame it", async () => {
		const server = await serveWeb();

		const { headers } = await fetch(`${server.url}/`);

		expect(headers.get("x-frame-options")).toBe("DENY");
		expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
	});

	it("serves only the API without a built UI", async () => {
		const server = await serve();

		expect((await fetch(`${server.url}/`)).status).toBe(404);
	});
});
