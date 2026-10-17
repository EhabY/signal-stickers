import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

import { isEnvironment, type Environment } from "../env.ts";
import type { ChatAuth } from "../net/chat.ts";
import { isNotFound } from "../util/isNotFound.ts";
import { isRecord } from "../util/isRecord.ts";

/** The credentials file exists but is not valid; the message never echoes its contents. */
export class CredentialsFormatError extends Error {
	override name = "CredentialsFormatError";
}

/** A linked device's credentials. The password grants API access as this device: never log it. */
export type Credentials = Readonly<{
	env: Environment;
	aci: string;
	pni?: string | undefined;
	/** The account's E.164 phone number, when the phone shared it while linking. */
	number?: string | undefined;
	deviceId: number;
	password: string;
	/** ISO 8601 time of linking. */
	createdAt: string;
}>;

/** Where one account's credentials live; v1 keeps a single account. */
export type CredentialsStore = Readonly<{
	/** The credentials file, so front ends can tell users which file is secret. */
	path: string;
	load(): Promise<Credentials | undefined>;
	/** Replaces any saved credentials, writing the file owner-only (0600, or an owner-only ACL). */
	save(credentials: Credentials): Promise<void>;
	/** Returns whether there were credentials to delete. */
	delete(): Promise<boolean>;
}>;

/** Where {@link defaultConfigDir} looks; tests pass another platform's values. */
export type ConfigDirOptions = Readonly<{
	platform?: NodeJS.Platform | undefined;
	env?: Readonly<Record<string, string | undefined>> | undefined;
	home?: string | undefined;
}>;

const CREDENTIALS_FILE = "credentials.json";
const APP_DIR = "signal-stickers";

/**
 * The tool's own config directory: `%APPDATA%\signal-stickers` on Windows,
 * `~/Library/Application Support/signal-stickers` on macOS, and
 * `${XDG_CONFIG_HOME:-~/.config}/signal-stickers` elsewhere.
 */
export function defaultConfigDir({
	platform = process.platform,
	env = process.env,
	home = homedir(),
}: ConfigDirOptions = {}): string {
	if (platform === "win32") {
		const appData = env.APPDATA;
		const roaming =
			appData !== undefined && win32.isAbsolute(appData)
				? appData
				: win32.join(home, "AppData", "Roaming");
		return win32.join(roaming, APP_DIR);
	}
	if (platform === "darwin") {
		return posix.join(home, "Library", "Application Support", APP_DIR);
	}
	// The XDG spec says to ignore a relative XDG_CONFIG_HOME.
	const xdg = env.XDG_CONFIG_HOME;
	const config = xdg !== undefined && posix.isAbsolute(xdg) ? xdg : posix.join(home, ".config");
	return posix.join(config, APP_DIR);
}

/** Stores {@link CREDENTIALS_FILE} in `dir`, creating `dir` on save. */
export function createCredentialsStore(dir: string = defaultConfigDir()): CredentialsStore {
	const path = join(dir, CREDENTIALS_FILE);
	return {
		path,
		load: async (): Promise<Credentials | undefined> => {
			let text: string;
			try {
				text = await readFile(path, "utf8");
			} catch (error) {
				if (isNotFound(error)) {
					return undefined;
				}
				throw error;
			}
			return parseCredentials(text, path);
		},
		save: async (credentials) => {
			const text = `${JSON.stringify(validateCredentials(credentials, path), null, "\t")}\n`;
			await mkdir(dir, { recursive: true, mode: 0o700 });
			// Restricted while still empty, then renamed over the old file, which keeps the new permissions.
			const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
			try {
				await writeFile(temp, "", { flag: "wx", mode: 0o600 });
				await restrictToOwner(temp);
				await writeFile(temp, text);
				await rename(temp, path);
			} catch (error) {
				await rm(temp, { force: true });
				throw error;
			}
		},
		delete: async () => {
			try {
				await rm(path);
				return true;
			} catch (error) {
				if (isNotFound(error)) {
					return false;
				}
				throw error;
			}
		},
	};
}

/** Basic auth as this linked device: `aci.deviceId` and its password. */
export function getChatAuth({ aci, deviceId, password }: Credentials): ChatAuth {
	return { username: `${aci}.${deviceId}`, password };
}

/** Tells the user that `path` is a secret and why; front ends show it after saving credentials. */
export function credentialsWarning(path: string): string {
	return (
		`${path} holds this device's Signal password. Keep it private: anyone who has it can act ` +
		"as this linked device until you unlink it."
	);
}

function parseCredentials(text: string, path: string): Credentials {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		// JSON.parse quotes the text it fails on, which may be the password.
		throw new CredentialsFormatError(`${path} is not valid JSON`);
	}
	return validateCredentials(value, path);
}

function validateCredentials(value: unknown, path: string): Credentials {
	const invalid = (field: string) => new CredentialsFormatError(`${path} has an invalid ${field}`);
	if (!isRecord(value)) {
		throw new CredentialsFormatError(`${path} must hold a JSON object`);
	}
	const { env, aci, pni, number, deviceId, password, createdAt } = value;
	const optionalString = (field: unknown, name: string): string | undefined => {
		if (field !== undefined && typeof field !== "string") {
			throw invalid(name);
		}
		return field;
	};
	if (!isEnvironment(env)) {
		throw invalid("env");
	}
	if (typeof aci !== "string" || aci === "") {
		throw invalid("aci");
	}
	if (typeof deviceId !== "number" || !Number.isInteger(deviceId) || deviceId < 1) {
		throw invalid("deviceId");
	}
	if (typeof password !== "string" || password === "") {
		throw invalid("password");
	}
	if (typeof createdAt !== "string") {
		throw invalid("createdAt");
	}
	return {
		env,
		aci,
		pni: optionalString(pni, "pni"),
		number: optionalString(number, "number"),
		deviceId,
		password,
		createdAt,
	};
}

/**
 * On Windows, leaves full control for the current user only: drops inherited entries and the SYSTEM
 * and Administrators entries a default ACL adds when the folder passes nothing down.
 */
async function restrictToOwner(file: string): Promise<void> {
	if (process.platform !== "win32") {
		return;
	}
	// Absolute paths, so a program on PATH named like these never sees the file.
	const system32 = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
	const user = await run(win32.join(system32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"]);
	const sid = /"(S-1-[\d-]+)"/u.exec(user)?.[1];
	if (sid === undefined) {
		throw new Error("Could not find the current Windows user's security identifier");
	}
	await run(win32.join(system32, "icacls.exe"), [
		file,
		"/inheritance:r",
		"/grant:r",
		`*${sid}:F`,
		"/remove:g",
		"*S-1-5-18",
		"*S-1-5-32-544",
	]);
}

/** Runs `file` without a shell or console window and returns its output. */
function run(file: string, args: readonly string[]): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	execFile(file, args, { windowsHide: true }, (error, stdout) => {
		if (error) {
			reject(error);
		} else {
			resolve(stdout);
		}
	});
	return promise;
}
