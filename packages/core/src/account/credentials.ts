import type { Environment } from "../env.ts";
import type { ChatAuth } from "../net/chat.ts";
import { NotImplementedError } from "../util/notImplemented.ts";

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

export const CREDENTIALS_FILE = "credentials.json";

/**
 * The tool's own config directory: `%APPDATA%\signal-stickers` on Windows,
 * `~/Library/Application Support/signal-stickers` on macOS, and
 * `${XDG_CONFIG_HOME:-~/.config}/signal-stickers` elsewhere.
 */
export function defaultConfigDir(): string {
	throw new NotImplementedError("defaultConfigDir");
}

/** Stores {@link CREDENTIALS_FILE} in `dir`, creating `dir` on save. */
export function createCredentialsStore(_dir: string = defaultConfigDir()): CredentialsStore {
	throw new NotImplementedError("createCredentialsStore");
}

/** Basic auth as this linked device: `aci.deviceId` and its password. */
export function getChatAuth({ aci, deviceId, password }: Credentials): ChatAuth {
	return { username: `${aci}.${deviceId}`, password };
}
