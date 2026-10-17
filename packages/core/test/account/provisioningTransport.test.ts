import type * as NetModule from "@signalapp/libsignal-client/dist/net.js";
import { Environment } from "@signalapp/libsignal-client/dist/net.js";
import { describe, expect, it, vi } from "vitest";

import {
	createProvisioningTransport,
	type ProvisioningConnection,
	type ProvisioningListener,
} from "../../src/account/provisioningTransport.ts";

const { createNet, connectProvisioning } = vi.hoisted(() => ({
	createNet: vi.fn<(options: unknown) => void>(),
	connectProvisioning: vi.fn<(...args: unknown[]) => Promise<ProvisioningConnection>>(() =>
		Promise.resolve({ disconnect: () => Promise.resolve() }),
	),
}));

// Never connect to Signal: libsignal's `Net` is replaced by one that records its use.
vi.mock("@signalapp/libsignal-client/dist/net.js", async (importOriginal) => ({
	...(await importOriginal<typeof NetModule>()),
	Net: class {
		connectProvisioning = connectProvisioning;

		constructor(options: unknown) {
			createNet(options);
		}
	},
}));

const LISTENER: ProvisioningListener = {
	onReceivedAddress: vi.fn<ProvisioningListener["onReceivedAddress"]>(),
	onReceivedEnvelope: vi.fn<ProvisioningListener["onReceivedEnvelope"]>(),
	onConnectionInterrupted: vi.fn<ProvisioningListener["onConnectionInterrupted"]>(),
};

describe("createProvisioningTransport", () => {
	it.each([
		["production", Environment.Production],
		["staging", Environment.Staging],
	] as const)("connects through libsignal's %s Net", async (env, netEnvironment) => {
		const transport = createProvisioningTransport(env);

		await transport(LISTENER);

		expect(createNet).toHaveBeenCalledWith({ env: netEnvironment, userAgent: "signal-stickers" });
	});

	it("reuses one Net and passes the listener and abort signal through", async () => {
		const transport = createProvisioningTransport("production");
		const { signal } = new AbortController();

		await transport(LISTENER, signal);
		await transport(LISTENER);

		expect(createNet).toHaveBeenCalledOnce();
		expect(connectProvisioning.mock.calls).toEqual([
			[LISTENER, { abortSignal: signal }],
			[LISTENER, {}],
		]);
	});
});
