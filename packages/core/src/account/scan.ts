import { LinkError } from "./linkError.ts";
import {
	createProvisioningCipher,
	type ProvisionedAccount,
	type ProvisioningCipher,
} from "./provisioningCipher.ts";
import type {
	ProvisioningConnection,
	ProvisioningListener,
	ProvisioningTransport,
} from "./provisioningTransport.ts";

export type ScanOptions = Readonly<{
	provisioning: ProvisioningTransport;
	signal?: AbortSignal | undefined;
	/** Called with each new QR code URL; the previous code stays scannable for one more interval. */
	onQrUrl: (qrUrl: string) => void;
}>;

// Signal Desktop's `Provisioner` timings.
export const ROTATION_INTERVAL_MS = 45_000;
export const MAX_QR_CODES = 6;
export const CONNECT_TIMEOUT_MS = 10_000;
/** Signal Desktop's `FIBONACCI_TIMEOUTS`: waits between failed connects while a code is shown. */
export const RETRY_DELAYS_MS = [1, 2, 3, 5, 8, 13, 21, 34, 55].map((seconds) => seconds * 1000);
const MAX_OPEN_SOCKETS = 2;

type Session = Readonly<{
	provisioning: ProvisioningTransport;
	/** Aborts when the caller cancels or the scan is over. */
	stopped: AbortSignal;
	scanned: PromiseWithResolvers<ProvisionedAccount>;
	/** Sockets whose QR code was shown, oldest first. */
	shown: ProvisioningConnection[];
}>;

/**
 * Shows QR codes until the phone scans one and returns what it sent. Like Signal Desktop, each code
 * has its own socket and key, and a new code replaces the shown one every 45 seconds.
 */
export async function waitForScan({
	provisioning,
	signal,
	onQrUrl,
}: ScanOptions): Promise<ProvisionedAccount> {
	const stop = new AbortController();
	const session: Session = {
		provisioning,
		stopped: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
		scanned: Promise.withResolvers(),
		shown: [],
	};
	showCodes(session, onQrUrl).catch(session.scanned.reject);
	try {
		return await session.scanned.promise;
	} finally {
		stop.abort();
		await Promise.all(session.shown.splice(0).map((connection) => connection.disconnect()));
	}
}

async function showCodes(
	session: Session,
	onQrUrl: (qrUrl: string) => void,
	remaining = MAX_QR_CODES,
	failedConnects = 0,
): Promise<never> {
	if (remaining === 0) {
		throw new LinkError("The QR code expired before it was scanned. Try again.");
	}
	const qrUrl = await openSocket(session).catch((error: unknown) => {
		// Like Signal Desktop, a failed connect only ends the scan when no shown code is still open.
		if (session.shown.length === 0) {
			throw error;
		}
		return null;
	});
	if (qrUrl === null) {
		const index = Math.min(failedConnects, RETRY_DELAYS_MS.length - 1);
		await delay(RETRY_DELAYS_MS[index] ?? 0, session.stopped);
		return showCodes(session, onQrUrl, remaining, failedConnects + 1);
	}
	const closing = session.shown.splice(0, Math.max(0, session.shown.length - MAX_OPEN_SOCKETS));
	await Promise.all(closing.map((old) => old.disconnect()));
	onQrUrl(qrUrl);
	await delay(ROTATION_INTERVAL_MS, session.stopped);
	return showCodes(session, onQrUrl, remaining - 1);
}

/** Connects a socket with a fresh key, adds it to the shown ones, and returns its QR code URL. */
async function openSocket(session: Session): Promise<string> {
	const cipher = await createProvisioningCipher();
	const socket = trackSocket(session, cipher);
	const timeoutError = new LinkError(
		"Timed out connecting to Signal. Check your network and try again.",
	);
	return withTimeout(CONNECT_TIMEOUT_MS, timeoutError, session.stopped, async (signal) => {
		const connection = await session.provisioning(socket.listener, signal);
		try {
			const qrUrl = buildQrUrl(await abortable(socket.address, signal), cipher.publicKey);
			socket.show(connection);
			return qrUrl;
		} catch (error) {
			await connection.disconnect();
			throw error;
		}
	});
}

/** Follows one socket: its address, then the envelope once its QR code is shown, or its closing. */
function trackSocket(session: Session, cipher: ProvisioningCipher) {
	const address = Promise.withResolvers<string>();
	// A connect that finishes after the scan stops closes its socket with nobody awaiting the address.
	address.promise.catch(() => null);
	let state: "connecting" | "shown" | "scanned" = "connecting";
	let shownConnection: ProvisioningConnection | undefined;
	const listener: ProvisioningListener = {
		onReceivedAddress: (value, ack) => {
			if (state === "connecting") {
				ack.send(200);
				address.resolve(value);
			}
		},
		onReceivedEnvelope: (envelope, ack) => {
			if (state !== "shown") {
				return;
			}
			state = "scanned";
			try {
				const account = cipher.decrypt(envelope);
				ack.send(200);
				session.scanned.resolve(account);
			} catch (error) {
				session.scanned.reject(error);
			}
		},
		onConnectionInterrupted: (cause) => {
			if (state === "connecting") {
				address.reject(new LinkError("Signal closed the connection. Try again.", { cause }));
			}
			const index = shownConnection ? session.shown.indexOf(shownConnection) : -1;
			if (state === "shown" && index !== -1 && index === session.shown.length - 1) {
				session.scanned.reject(
					new LinkError("Lost the connection to Signal before the scan. Try again.", { cause }),
				);
			}
			if (index !== -1) {
				session.shown.splice(index, 1);
			}
		},
	};
	const show = (connection: ProvisioningConnection) => {
		state = "shown";
		shownConnection = connection;
		session.shown.push(connection);
	};
	return { listener, address: address.promise, show };
}

/** Runs `task` with a signal that aborts with `timeoutError` after `ms`, or when `signal` aborts. */
async function withTimeout<T>(
	ms: number,
	timeoutError: Error,
	signal: AbortSignal,
	task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const timeout = new AbortController();
	const timer = setTimeout(() => {
		timeout.abort(timeoutError);
	}, ms);
	const combined = AbortSignal.any([signal, timeout.signal]);
	try {
		return await task(combined);
	} catch (error) {
		combined.throwIfAborted();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Signal Desktop's `linkDeviceRoute.toAppUrl`, without `backup5` since we never sync a backup. */
function buildQrUrl(address: string, publicKey: Uint8Array): string {
	const params = new URLSearchParams({
		uuid: address,
		pub_key: Buffer.from(publicKey).toString("base64"),
		capabilities: ["nopni", "nopni2"].join(","),
	});
	return `sgnl://linkdevice?${params.toString()}`;
}

/** Like `promise`, but rejects with `signal`'s reason as soon as it aborts. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	const aborted = Promise.withResolvers<never>();
	const onAbort = () => {
		aborted.reject(signal.reason);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, aborted.promise]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

/** Waits `ms` on the global timers, so tests can fake them. */
async function delay(ms: number, signal: AbortSignal): Promise<void> {
	const elapsed = Promise.withResolvers<void>();
	const timer = setTimeout(elapsed.resolve, ms);
	try {
		await abortable(elapsed.promise, signal);
	} finally {
		clearTimeout(timer);
	}
}
