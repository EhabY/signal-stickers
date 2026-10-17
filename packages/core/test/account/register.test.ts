import { describe, expect, it } from "vitest";

import type { ProvisionedAccount } from "../../src/account/provisioningCipher.ts";
import { buildLinkRequest, DEVICE_NAME } from "../../src/account/register.ts";
import { decryptDeviceName, isSignedBy, LINKED_ACCOUNT } from "../support/index.ts";

const ACCOUNT: ProvisionedAccount = {
	aci: LINKED_ACCOUNT.aci,
	aciIdentityKey: LINKED_ACCOUNT.aciIdentityKey,
	provisioningCode: LINKED_ACCOUNT.provisioningCode,
	phoneNumber: {
		number: LINKED_ACCOUNT.number,
		pni: LINKED_ACCOUNT.pni,
		pniIdentityKey: LINKED_ACCOUNT.pniIdentityKey,
	},
};

describe("buildLinkRequest", () => {
	it("has Signal Desktop's fields in Signal Desktop's order", async () => {
		const request = await buildLinkRequest(ACCOUNT);

		expect(Object.keys(request)).toEqual([
			"verificationCode",
			"accountAttributes",
			"aciSignedPreKey",
			"aciPqLastResortPreKey",
			"pniSignedPreKey",
			"pniPqLastResortPreKey",
		]);
		expect(Object.keys(request.accountAttributes)).toEqual([
			"fetchesMessages",
			"name",
			"registrationId",
			"pniRegistrationId",
			"capabilities",
		]);
	});

	it("sends the provisioning code and Signal Desktop's attributes", async () => {
		const { verificationCode, accountAttributes } = await buildLinkRequest(ACCOUNT);

		expect(verificationCode).toBe(LINKED_ACCOUNT.provisioningCode);
		expect(accountAttributes.fetchesMessages).toBe(true);
		expect(accountAttributes.capabilities).toEqual({
			attachmentBackfill: true,
			spqr: true,
			usernameChangeSyncMessage: true,
			optionalPhoneNumber: false,
		});
	});

	it("encrypts the device name to the ACI identity", async () => {
		const { accountAttributes } = await buildLinkRequest(ACCOUNT);

		expect(decryptDeviceName(accountAttributes.name, LINKED_ACCOUNT.aciIdentityKey)).toBe(
			DEVICE_NAME,
		);
	});

	it("generates a registration id for each identity", async () => {
		const { accountAttributes } = await buildLinkRequest(ACCOUNT);

		expect(accountAttributes.registrationId).toBeGreaterThanOrEqual(1);
		expect(accountAttributes.pniRegistrationId).toBeGreaterThanOrEqual(1);
	});

	it("signs each identity's prekeys with that identity's key", async () => {
		const request = await buildLinkRequest(ACCOUNT);

		expect(isSignedBy(LINKED_ACCOUNT.aciIdentityKey, request.aciSignedPreKey)).toBe(true);
		expect(isSignedBy(LINKED_ACCOUNT.aciIdentityKey, request.aciPqLastResortPreKey)).toBe(true);
		expect(isSignedBy(LINKED_ACCOUNT.pniIdentityKey, request.pniSignedPreKey!)).toBe(true);
		expect(isSignedBy(LINKED_ACCOUNT.pniIdentityKey, request.pniPqLastResortPreKey!)).toBe(true);
	});

	it("sends no PNI fields and an optional phone number without a phone number", async () => {
		const request = await buildLinkRequest({ ...ACCOUNT, phoneNumber: undefined });

		expect(request.accountAttributes.capabilities.optionalPhoneNumber).toBe(true);
		expect(JSON.stringify(request)).not.toMatch(/"pni/iu);
	});
});
