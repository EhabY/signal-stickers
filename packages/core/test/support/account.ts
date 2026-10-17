import type { Credentials, CredentialsStore } from "../../src/account/credentials.ts";

export const CREDENTIALS: Credentials = {
	env: "production",
	aci: "9d0652a3-dcc3-4d11-975f-74d61598733f",
	deviceId: 2,
	password: "device-password",
	createdAt: "2026-10-17T00:00:00.000Z",
};

export type MemoryCredentialsStore = CredentialsStore & { current(): Credentials | undefined };

/** A {@link CredentialsStore} that keeps credentials in memory, starting with `initial`. */
export function memoryCredentialsStore(initial?: Credentials): MemoryCredentialsStore {
	let saved = initial;
	return {
		path: "/config/signal-stickers/credentials.json",
		current: () => saved,
		load: () => Promise.resolve(saved),
		save: (credentials) => {
			saved = credentials;
			return Promise.resolve();
		},
		delete: () => {
			const existed = saved !== undefined;
			saved = undefined;
			return Promise.resolve(existed);
		},
	};
}
