import { describe, expect, it } from "vitest";

import { ProtobufWriter } from "../../src/protocol/protobuf.ts";
import {
	decodeDeviceName,
	decodeProvisionEnvelope,
	decodeProvisionMessage,
	encodeDeviceName,
	encodeProvisionEnvelope,
	encodeProvisionMessage,
	type ProvisionMessageProto,
} from "../../src/protocol/provisioning.ts";

const bytes = (...values: number[]) => Buffer.from(values);
const hex = (encoded: Uint8Array) => Buffer.from(encoded).toString("hex");

const MESSAGE: ProvisionMessageProto = {
	aciIdentityKeyPrivate: bytes(1),
	number: "+1",
	provisioningCode: "code",
	aci: "aci",
	pni: "pni",
	pniIdentityKeyPrivate: bytes(2),
	aciBinary: bytes(3),
	pniBinary: bytes(4),
};

describe("ProvisionEnvelope", () => {
	it("encodes publicKey as field 1 and body as field 2", () => {
		const encoded = encodeProvisionEnvelope({ publicKey: bytes(5, 6), body: bytes(7) });

		expect(hex(encoded)).toBe(["0a020506", "120107"].join(""));
	});

	it("round-trips", () => {
		const envelope = { publicKey: bytes(5, 6), body: bytes(7) };

		expect(decodeProvisionEnvelope(encodeProvisionEnvelope(envelope))).toEqual(envelope);
	});
});

describe("ProvisionMessage", () => {
	it("encodes each field with Signal's field number", () => {
		expect(hex(encodeProvisionMessage(MESSAGE))).toBe(
			[
				"120101",
				"1a022b31",
				"2204636f6465",
				"4203616369",
				"5203706e69",
				"620102",
				"8a010103",
				"92010104",
			].join(""),
		);
	});

	it("round-trips", () => {
		expect(decodeProvisionMessage(encodeProvisionMessage(MESSAGE))).toEqual(MESSAGE);
	});

	it("skips the fields linking does not use", () => {
		const unused = new ProtobufWriter()
			.bytes(1, bytes(9))
			.string(5, "user agent")
			.bytes(6, bytes(9))
			.uint32(7, 1)
			.uint32(9, 1)
			.bytes(11, bytes(9))
			.bytes(13, bytes(9))
			.string(15, "entropy")
			.bytes(19, bytes(9))
			.finish();

		const decoded = decodeProvisionMessage(
			Buffer.concat([unused, encodeProvisionMessage(MESSAGE)]),
		);

		expect(decoded).toEqual(MESSAGE);
	});
});

describe("DeviceName", () => {
	it("encodes ephemeralPublic, syntheticIv, and ciphertext as fields 1 to 3", () => {
		const encoded = encodeDeviceName({
			ephemeralPublic: bytes(1),
			syntheticIv: bytes(2),
			ciphertext: bytes(3),
		});

		expect(hex(encoded)).toBe(["0a0101", "120102", "1a0103"].join(""));
	});

	it("round-trips", () => {
		const name = { ephemeralPublic: bytes(1), syntheticIv: bytes(2), ciphertext: bytes(3) };

		expect(decodeDeviceName(encodeDeviceName(name))).toEqual(name);
	});
});
