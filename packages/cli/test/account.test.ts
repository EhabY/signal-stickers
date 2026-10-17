import {
	CredentialsFormatError,
	credentialsWarning,
	unlinkDevice as unlinkThroughCore,
} from "@signal-stickers/core";
import {
	CREDENTIALS,
	fakeChat,
	LINK_RESPONSE,
	LINKED_ACCOUNT,
	linkDeviceByScanning,
	memoryCredentialsStore,
} from "@signal-stickers/core/testing";
import { toString as renderQr } from "qrcode";
import { describe, expect, it } from "vitest";

import { fakeLinkDevice, fakeUnlinkDevice, QR_URL, runCli, unusedChat } from "./support.ts";

const STORE_PATH = memoryCredentialsStore().path;

describe("link", () => {
	it("shows the QR code and progress, then saves the credentials and warns they are secret", async () => {
		const credentialsStore = memoryCredentialsStore();

		const { code, stdout, stderr } = await runCli(["link"], {
			credentialsStore,
			linkDevice: fakeLinkDevice(),
		});

		const qr = await renderQr(QR_URL, { type: "terminal", small: true });
		expect(code).toBe(0);
		expect(credentialsStore.current()).toEqual(CREDENTIALS);
		expect(stdout).toBe("Linked to Signal production as device 2\n");
		expect(stderr).toBe(
			[
				"Linking to Signal production",
				"Connecting",
				qr,
				"Scan this code in the Signal app on your phone: Settings > Linked devices > Link new device",
				"Registering this device",
				credentialsWarning(STORE_PATH),
				"",
			].join("\n"),
		);
	});

	it("links in the selected environment with the chat service and abort signal", async () => {
		const chat = unusedChat();
		const linkDevice = fakeLinkDevice();

		const { code, stdout, signal } = await runCli(["link", "--staging"], { chat, linkDevice });

		expect(code).toBe(0);
		expect(stdout).toBe("Linked to Signal staging as device 2\n");
		expect(linkDevice).toHaveBeenCalledWith(
			expect.objectContaining({ env: "staging", createChat: chat.factory, signal }),
		);
	});

	it("links through core when the phone scans the QR code", async () => {
		const credentialsStore = memoryCredentialsStore();

		const { code, stdout } = await runCli(["link"], {
			credentialsStore,
			chat: fakeChat(() => LINK_RESPONSE),
			linkDevice: linkDeviceByScanning(),
		});

		expect(code).toBe(0);
		expect(stdout).toBe(`Linked to Signal production as device ${LINK_RESPONSE.deviceId}\n`);
		expect(credentialsStore.current()).toMatchObject({
			env: "production",
			aci: LINK_RESPONSE.uuid,
			deviceId: LINK_RESPONSE.deviceId,
		});
	});

	it("finishes printing the QR code before reporting a failure", async () => {
		const linkDevice = fakeLinkDevice(new Error("Linking timed out"));

		const { code, stderr } = await runCli(["link"], { linkDevice });

		expect(code).toBe(1);
		expect(stderr).toMatch(/Link new device\nError: Linking timed out\n$/u);
	});

	it("refuses when already linked", async () => {
		const linkDevice = fakeLinkDevice();

		const { code, stderr } = await runCli(["link"], {
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
			linkDevice,
		});

		expect(code).toBe(1);
		expect(stderr).toBe(
			'Error: Already linked to Signal production as device 2. Run "signal-stickers unlink" first.\n',
		);
		expect(linkDevice).not.toHaveBeenCalled();
	});

	it("explains how to recover when the credentials cannot be saved", async () => {
		const credentialsStore = {
			...memoryCredentialsStore(),
			save: () => Promise.reject(new Error("Disk full")),
		};

		const { code, stderr } = await runCli(["link"], {
			credentialsStore,
			linkDevice: fakeLinkDevice(),
		});

		expect(code).toBe(1);
		expect(stderr).toContain(
			`Error: Linked, but could not save the credentials to ${STORE_PATH} (Disk full). Remove "signal-stickers" from Linked devices on your phone, then link again.\n`,
		);
	});
});

describe("status", () => {
	it("describes the linked account without the password", async () => {
		const credentials = { ...CREDENTIALS, number: LINKED_ACCOUNT.number };

		const { code, stdout, stderr } = await runCli(["status"], {
			credentialsStore: memoryCredentialsStore(credentials),
		});

		expect(code).toBe(0);
		expect(stdout).toBe(
			[
				"Linked to Signal production as device 2",
				`Account: ${CREDENTIALS.aci}`,
				`Phone number: ${LINKED_ACCOUNT.number}`,
				`Linked at: ${CREDENTIALS.createdAt}`,
				`Credentials: ${STORE_PATH}`,
				"",
			].join("\n"),
		);
		expect(stdout).not.toContain(CREDENTIALS.password);
		expect(stderr).toBe("");
	});

	it.each([
		["--staging", ["--staging"], {}],
		["SIGNAL_STICKERS_ENV", [], { SIGNAL_STICKERS_ENV: "staging" }],
	])("warns when %s selects another environment than the device's", async (_, flags, env) => {
		const { code, stderr } = await runCli(["status", ...flags], {
			env,
			credentialsStore: memoryCredentialsStore(CREDENTIALS),
		});

		expect(code).toBe(0);
		expect(stderr).toBe(
			"Warning: Linked to Signal production, not staging. Remove --staging and SIGNAL_STICKERS_ENV to use it.\n",
		);
	});

	it("tells how to select a device linked on staging", async () => {
		const { stderr } = await runCli(["status"], {
			credentialsStore: memoryCredentialsStore({ ...CREDENTIALS, env: "staging" }),
		});

		expect(stderr).toBe(
			"Warning: Linked to Signal staging, not production. Add --staging to use it.\n",
		);
	});

	it("explains how to link when not linked", async () => {
		const { code, stdout } = await runCli(["status"]);

		expect(code).toBe(0);
		expect(stdout).toBe(
			'Not linked. Run "signal-stickers link" to link this tool as a Signal device.\n',
		);
	});
});

describe("unlink", () => {
	it("removes the device through core", async () => {
		const chat = fakeChat(() => null);
		const credentialsStore = memoryCredentialsStore(CREDENTIALS);

		const { code } = await runCli(["unlink"], {
			chat,
			credentialsStore,
			unlinkDevice: unlinkThroughCore,
		});

		expect(code).toBe(0);
		expect(chat.requests).toMatchObject([
			{ method: "DELETE", path: `/v1/devices/${CREDENTIALS.deviceId}` },
		]);
		expect(credentialsStore.current()).toBeUndefined();
	});

	it("removes the device from the account, then deletes the credentials", async () => {
		const chat = unusedChat();
		const credentialsStore = memoryCredentialsStore(CREDENTIALS);
		const unlinkDevice = fakeUnlinkDevice();

		const { code, stdout, stderr, signal } = await runCli(["unlink"], {
			chat,
			credentialsStore,
			unlinkDevice,
		});

		expect(code).toBe(0);
		expect(unlinkDevice).toHaveBeenCalledWith({
			credentials: CREDENTIALS,
			createChat: chat.factory,
			signal,
		});
		expect(credentialsStore.current()).toBeUndefined();
		expect(stderr).toBe("Unlinking device 2 from Signal production\n");
		expect(stdout).toBe(`Unlinked and deleted ${STORE_PATH}\n`);
	});

	it("keeps the credentials when the account cannot be reached", async () => {
		const credentialsStore = memoryCredentialsStore(CREDENTIALS);
		const unlinkDevice = fakeUnlinkDevice(new Error("Network down"));

		const { code, stderr } = await runCli(["unlink"], { credentialsStore, unlinkDevice });

		expect(code).toBe(1);
		expect(stderr).toContain(
			'Error: Network down. If Signal can\'t be reached, run "signal-stickers unlink --local"',
		);
		expect(credentialsStore.current()).toEqual(CREDENTIALS);
	});

	it("only deletes the credentials with --local", async () => {
		const credentialsStore = memoryCredentialsStore(CREDENTIALS);

		const { code, stdout, stderr } = await runCli(["unlink", "--local"], { credentialsStore });

		expect(code).toBe(0);
		expect(credentialsStore.current()).toBeUndefined();
		expect(stdout).toBe(`Deleted ${STORE_PATH}\n`);
		expect(stderr).toBe(
			'If "signal-stickers" is still in Linked devices in Signal on your phone (Settings > Linked devices), remove it there.\n',
		);
	});

	it("deletes credentials that no longer load with --local", async () => {
		const credentialsStore = {
			...memoryCredentialsStore(CREDENTIALS),
			load: () => Promise.reject(new CredentialsFormatError(`${STORE_PATH} is not valid JSON`)),
		};

		const { code, stdout } = await runCli(["unlink", "--local"], { credentialsStore });

		expect(code).toBe(0);
		expect(credentialsStore.current()).toBeUndefined();
		expect(stdout).toBe(`Deleted ${STORE_PATH}\n`);
	});

	it("does nothing with --local when not linked", async () => {
		const { code, stdout } = await runCli(["unlink", "--local"]);

		expect({ code, stdout }).toEqual({ code: 0, stdout: "Not linked\n" });
	});

	it("does nothing when not linked", async () => {
		const { code, stdout } = await runCli(["unlink"]);

		expect({ code, stdout }).toEqual({ code: 0, stdout: "Not linked\n" });
	});

	it("unlinks in the environment the device was linked in", async () => {
		const credentialsStore = memoryCredentialsStore(CREDENTIALS);
		const unlinkDevice = fakeUnlinkDevice();

		const { code, stderr } = await runCli(["unlink", "--staging"], {
			credentialsStore,
			unlinkDevice,
		});

		expect(code).toBe(0);
		expect(stderr).toBe("Unlinking device 2 from Signal production\n");
		expect(credentialsStore.current()).toBeUndefined();
	});
});
