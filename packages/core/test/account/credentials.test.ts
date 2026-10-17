import { execFileSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	createCredentialsStore,
	CredentialsFormatError,
	credentialsWarning,
	defaultConfigDir,
	getChatAuth,
} from "../../src/account/credentials.ts";
import { CREDENTIALS, LINKED_ACCOUNT, tempDir } from "../support/index.ts";

const LINKED = { ...CREDENTIALS, pni: LINKED_ACCOUNT.pni, number: LINKED_ACCOUNT.number };

async function store() {
	const dir = join(await tempDir(), "config");
	return createCredentialsStore(dir);
}

/** The file's access control entries as `icacls` lists them, e.g. `HOST\user:(F)`. */
function accessEntries(path: string): string[] {
	const output = execFileSync("icacls", [path], { encoding: "utf8" });
	return output
		.replace(path, "")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("Successfully processed"));
}

function currentUserSid(): string {
	const whoami = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
	const output = execFileSync(whoami, ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
	return /"(S-1-[\d-]+)"/u.exec(output)?.[1] ?? "";
}

describe("defaultConfigDir", () => {
	it.each<{ platform: NodeJS.Platform; env: Record<string, string>; home: string; dir: string }>([
		{
			platform: "win32",
			env: { APPDATA: "D:\\Roaming" },
			home: "C:\\Users\\me",
			dir: "D:\\Roaming\\signal-stickers",
		},
		{
			platform: "win32",
			env: {},
			home: "C:\\Users\\me",
			dir: "C:\\Users\\me\\AppData\\Roaming\\signal-stickers",
		},
		{
			platform: "darwin",
			env: {},
			home: "/Users/me",
			dir: "/Users/me/Library/Application Support/signal-stickers",
		},
		{
			platform: "linux",
			env: { XDG_CONFIG_HOME: "/xdg" },
			home: "/home/me",
			dir: "/xdg/signal-stickers",
		},
		{
			platform: "linux",
			env: { XDG_CONFIG_HOME: "relative" },
			home: "/home/me",
			dir: "/home/me/.config/signal-stickers",
		},
		{ platform: "linux", env: {}, home: "/home/me", dir: "/home/me/.config/signal-stickers" },
	])("is $dir on $platform with $env", ({ platform, env, home, dir }) => {
		expect(defaultConfigDir({ platform, env, home })).toBe(dir);
	});
});

describe("createCredentialsStore", () => {
	it("saves and loads credentials", async () => {
		const credentials = await store();

		await credentials.save(LINKED);

		expect(await credentials.load()).toEqual(LINKED);
	});

	it("loads nothing before saving", async () => {
		const credentials = await store();

		expect(await credentials.load()).toBeUndefined();
	});

	it("replaces saved credentials and leaves no temporary file", async () => {
		const credentials = await store();
		await credentials.save(LINKED);

		await credentials.save(CREDENTIALS);

		expect(await credentials.load()).toEqual(CREDENTIALS);
		expect(await readdir(join(credentials.path, ".."))).toEqual(["credentials.json"]);
	});

	it.runIf(process.platform !== "win32")(
		"writes the file with mode 0600, also when replacing",
		async () => {
			const credentials = await store();
			await credentials.save(LINKED);
			await writeFile(credentials.path, "{}", { mode: 0o644 });

			await credentials.save(LINKED);

			expect((await stat(credentials.path)).mode & 0o777).toBe(0o600);
		},
	);

	it.runIf(process.platform === "win32")("grants access to the current user only", async () => {
		const parent = await tempDir();
		// Like a CI runner's temp folder: nothing is inherited, so new files get explicit entries.
		execFileSync("icacls", [
			parent,
			"/inheritance:r",
			"/grant:r",
			`*${currentUserSid()}:F`,
			"*S-1-5-18:F",
		]);
		const credentials = createCredentialsStore(join(parent, "config"));

		await credentials.save(LINKED);

		const entries = accessEntries(credentials.path);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.toLowerCase()).toMatch(
			new RegExp(`\\\\${userInfo().username.toLowerCase()}:\\(f\\)$`, "u"),
		);
	});

	it("deletes saved credentials and reports whether there were any", async () => {
		const credentials = await store();
		await credentials.save(LINKED);

		expect(await credentials.delete()).toBe(true);
		expect(await credentials.delete()).toBe(false);
		expect(await credentials.load()).toBeUndefined();
	});

	it("rejects a file that is not JSON without echoing it", async () => {
		const credentials = await store();
		await credentials.save(LINKED);
		await writeFile(credentials.path, "hunter2-not-json");

		const error = await credentials.load().catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(CredentialsFormatError);
		expect(String(error)).not.toContain("hunter2");
		expect(error).not.toHaveProperty("cause");
	});

	it.each([
		["env", { env: "dev" }],
		["aci", { aci: 7 }],
		["deviceId", { deviceId: 0 }],
		["password", { password: "" }],
		["createdAt", { createdAt: undefined }],
		["pni", { pni: 5 }],
		["number", { number: null }],
	])("rejects an invalid %s without echoing it", async (field, change) => {
		const credentials = await store();
		await credentials.save(LINKED);
		await writeFile(credentials.path, JSON.stringify({ ...LINKED, ...change }));

		await expect(credentials.load()).rejects.toThrow(`has an invalid ${field}`);
	});

	it("refuses to save invalid credentials", async () => {
		const credentials = await store();

		await expect(credentials.save({ ...LINKED, deviceId: 1.5 })).rejects.toThrow(
			CredentialsFormatError,
		);
		expect(await credentials.load()).toBeUndefined();
	});

	it("writes readable JSON", async () => {
		const credentials = await store();

		await credentials.save(CREDENTIALS);

		expect(await readFile(credentials.path, "utf8")).toBe(
			`${JSON.stringify(CREDENTIALS, null, "\t")}\n`,
		);
	});
});

describe("credentialsWarning", () => {
	it("names the file and why it is secret", () => {
		expect(credentialsWarning("/config/credentials.json")).toMatch(
			/^\/config\/credentials\.json holds this device's Signal password\./u,
		);
	});
});

describe("getChatAuth", () => {
	it("authenticates as aci.deviceId", () => {
		expect(getChatAuth(CREDENTIALS)).toEqual({
			username: `${CREDENTIALS.aci}.2`,
			password: CREDENTIALS.password,
		});
	});
});
