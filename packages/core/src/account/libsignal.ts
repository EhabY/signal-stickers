import type * as LibsignalModule from "@signalapp/libsignal-client";

export type Libsignal = typeof LibsignalModule;

/** Loads libsignal's native addon on first use, so commands that never link, like `pull`, skip it. */
export function loadLibsignal(): Promise<Libsignal> {
	return import("@signalapp/libsignal-client");
}
