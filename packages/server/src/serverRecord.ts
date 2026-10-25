import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ignoreNotFound, isEnvironment, type Environment } from "@signal-stickers/core";

import type { StatusResponse } from "./api.ts";
import { HOST } from "./server.ts";

export type RecordedServer = Readonly<{ url: string; env: Environment }>;

/** Where the server for `packDir` records its URL, so starting another for that pack opens it. */
export function serverRecordFile(configDir: string, packDir: string): string {
	const id = createHash("sha256").update(packDir).digest("hex").slice(0, 16);
	return join(configDir, "servers", `${id}.json`);
}

/** The server recorded in `file`, unless it has stopped answering. */
export async function findRecordedServer(file: string): Promise<RecordedServer | undefined> {
	const url = await readFile(file, "utf8").then(parseUrl, ignoreNotFound);
	if (url === undefined) {
		return undefined;
	}
	try {
		const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2000) });
		const status: unknown = await response.json();
		return isStatus(status) ? { url, env: status.env } : undefined;
	} catch {
		return undefined;
	}
}

/** Records `url` in `file` and resolves a function that removes it again. */
export async function recordServer(file: string, url: string): Promise<() => Promise<void>> {
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify({ url }));
	return async () => {
		// A server started after this one stopped answering may have replaced the record.
		if ((await readFile(file, "utf8").then(parseUrl, ignoreNotFound)) === url) {
			await rm(file, { force: true });
		}
	};
}

/** Only a URL on {@link HOST}, so the record cannot send the browser elsewhere. */
function parseUrl(text: string): string | undefined {
	try {
		const record: unknown = JSON.parse(text);
		const url = typeof record === "object" && record !== null && "url" in record ? record.url : "";
		return typeof url === "string" && URL.parse(url)?.hostname === HOST ? url : undefined;
	} catch {
		return undefined;
	}
}

function isStatus(value: unknown): value is Pick<StatusResponse, "env"> {
	return typeof value === "object" && value !== null && "env" in value && isEnvironment(value.env);
}
