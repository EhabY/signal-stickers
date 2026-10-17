import { describe, expect, it, onTestFinished, vi } from "vitest";

import { LinkError } from "../../src/account/linkError.ts";
import {
	CONNECT_TIMEOUT_MS,
	MAX_QR_CODES,
	RETRY_DELAYS_MS,
	ROTATION_INTERVAL_MS,
	waitForScan,
} from "../../src/account/scan.ts";
import {
	fakeProvisioning,
	LINKED_ACCOUNT,
	PROVISION_MESSAGE,
	type FakeProvisioningOptions,
} from "../support/index.ts";

/**
 * Starts waiting for a scan on fake timers, cancelled when the test finishes. `shown(n)` waits for
 * the `n`th QR code and returns it.
 */
function scanning(options: FakeProvisioningOptions = {}) {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const controller = new AbortController();
	const provisioning = fakeProvisioning(options);
	const qrUrls: string[] = [];
	const scanned = waitForScan({
		provisioning: provisioning.transport,
		signal: controller.signal,
		onQrUrl: (qrUrl) => {
			qrUrls.push(qrUrl);
		},
	});
	// Tests that expect no result leave the scan to be cancelled at the end.
	scanned.catch(() => null);
	onTestFinished(() => {
		controller.abort();
		vi.useRealTimers();
	});
	const shown = async (count: number) => {
		await vi.waitFor(() => {
			expect(qrUrls).toHaveLength(count);
		});
		return qrUrls[count - 1]!;
	};
	return { provisioning, controller, scanned, shown };
}

describe("waitForScan", () => {
	it("returns what the phone sent for the shown code and closes its sockets", async () => {
		const { provisioning, scanned, shown } = scanning();

		provisioning.scan(await shown(1));

		expect((await scanned).aci).toBe(LINKED_ACCOUNT.aci);
		expect(provisioning.sockets).toMatchObject([{ acks: [200, 200], disconnected: true }]);
	});

	it("builds the QR code URL like Signal Desktop", async () => {
		const { shown } = scanning();

		const qrUrl = await shown(1);

		expect(qrUrl).toMatch(
			/^sgnl:\/\/linkdevice\?uuid=provisioning-address-1&pub_key=[\w%]+&capabilities=nopni%2Cnopni2$/u,
		);
		const publicKey = Buffer.from(new URL(qrUrl).searchParams.get("pub_key")!, "base64");
		expect(publicKey).toHaveLength(33);
	});

	it("shows a new code every 45 seconds and accepts the previous one", async () => {
		const { provisioning, scanned, shown } = scanning();
		const first = await shown(1);

		await vi.advanceTimersByTimeAsync(ROTATION_INTERVAL_MS);
		const second = await shown(2);
		provisioning.scan(first);

		expect(second).not.toBe(first);
		expect((await scanned).aci).toBe(LINKED_ACCOUNT.aci);
		expect(provisioning.sockets.map(({ disconnected }) => disconnected)).toEqual([true, true]);
	});

	it("keeps only the two newest codes open", async () => {
		const { provisioning, shown } = scanning();
		await shown(1);

		await vi.advanceTimersByTimeAsync(2 * ROTATION_INTERVAL_MS);
		await shown(3);

		expect(provisioning.sockets.map(({ disconnected }) => disconnected)).toEqual([
			true,
			false,
			false,
		]);
	});

	it("gives up when no code was scanned in time", async () => {
		const { provisioning, scanned, shown } = scanning();
		await shown(1);

		await vi.advanceTimersByTimeAsync(MAX_QR_CODES * ROTATION_INTERVAL_MS);

		await expect(scanned).rejects.toThrow("The QR code expired");
		expect(provisioning.sockets).toHaveLength(MAX_QR_CODES);
		expect(provisioning.sockets.every(({ disconnected }) => disconnected)).toBe(true);
	});

	it("stops and closes its sockets when aborted", async () => {
		const { provisioning, controller, scanned, shown } = scanning();
		await shown(1);

		controller.abort(new Error("cancelled"));

		await expect(scanned).rejects.toThrow("cancelled");
		expect(provisioning.sockets[0]?.disconnected).toBe(true);
	});

	it("fails when the shown code's socket drops", async () => {
		const { provisioning, scanned, shown } = scanning();
		await shown(1);

		provisioning.interrupt(provisioning.sockets[0]!);

		await expect(scanned).rejects.toThrow(LinkError);
	});

	it("ignores a dropped socket whose code was replaced", async () => {
		const { provisioning, scanned, shown } = scanning();
		await shown(1);
		await vi.advanceTimersByTimeAsync(ROTATION_INTERVAL_MS);
		const second = await shown(2);

		provisioning.interrupt(provisioning.sockets[0]!);
		provisioning.scan(second);

		expect((await scanned).aci).toBe(LINKED_ACCOUNT.aci);
	});

	it("keeps the shown code and retries when the next one cannot connect", async () => {
		const { provisioning, scanned, shown } = scanning({
			connecting: [() => Promise.resolve(), () => Promise.reject(new Error("offline"))],
		});
		const first = await shown(1);

		await vi.advanceTimersByTimeAsync(ROTATION_INTERVAL_MS + RETRY_DELAYS_MS[0]!);
		await shown(2);
		provisioning.scan(first);

		expect((await scanned).aci).toBe(LINKED_ACCOUNT.aci);
		expect(provisioning.sockets).toHaveLength(2);
	});

	it("fails when no code can connect", async () => {
		const { scanned } = scanning({ connecting: [() => Promise.reject(new Error("offline"))] });

		await expect(scanned).rejects.toThrow("offline");
	});

	it("closes a socket that connects after the scan", async () => {
		const late = Promise.withResolvers<void>();
		const { provisioning, scanned, shown } = scanning({
			connecting: [() => Promise.resolve(), () => late.promise],
		});
		const first = await shown(1);
		await vi.advanceTimersByTimeAsync(ROTATION_INTERVAL_MS);

		provisioning.scan(first);
		await scanned;
		late.resolve();

		await vi.waitFor(() => {
			expect(provisioning.sockets[1]?.disconnected).toBe(true);
		});
	});

	it("times out when the server sends no address", async () => {
		const { provisioning, scanned } = scanning({ sendAddress: false });
		await vi.waitFor(() => {
			expect(provisioning.sockets).toHaveLength(1);
		});

		await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);

		await expect(scanned).rejects.toThrow("Timed out connecting to Signal");
		expect(provisioning.sockets[0]?.disconnected).toBe(true);
	});

	it("rejects linking data it cannot use without acknowledging it", async () => {
		const message = { ...PROVISION_MESSAGE, provisioningCode: undefined };
		const { provisioning, scanned, shown } = scanning({ message });

		provisioning.scan(await shown(1));

		await expect(scanned).rejects.toThrow(LinkError);
		expect(provisioning.sockets[0]?.acks).toEqual([200]);
	});
});
