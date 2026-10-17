import { asBytes, asString, ProtobufWriter, readFields } from "./protobuf.ts";

/** What the phone sends through the provisioning socket: its ephemeral key and the encrypted body. */
export type ProvisionEnvelopeProto = {
	publicKey?: Uint8Array | undefined;
	body?: Uint8Array | undefined;
};

/** The `ProvisionMessage` fields linking uses; Signal's other fields are skipped. */
export type ProvisionMessageProto = {
	aciIdentityKeyPrivate?: Uint8Array | undefined;
	number?: string | undefined;
	provisioningCode?: string | undefined;
	aci?: string | undefined;
	pni?: string | undefined;
	pniIdentityKeyPrivate?: Uint8Array | undefined;
	aciBinary?: Uint8Array | undefined;
	pniBinary?: Uint8Array | undefined;
};

/** A device name encrypted to the account's identity key. */
export type DeviceNameProto = {
	ephemeralPublic?: Uint8Array | undefined;
	syntheticIv?: Uint8Array | undefined;
	ciphertext?: Uint8Array | undefined;
};

export function decodeProvisionEnvelope(bytes: Uint8Array): ProvisionEnvelopeProto {
	const envelope: ProvisionEnvelopeProto = {};
	for (const field of readFields(bytes)) {
		if (field.number === 1) {
			envelope.publicKey = asBytes(field);
		} else if (field.number === 2) {
			envelope.body = asBytes(field);
		}
	}
	return envelope;
}

export function encodeProvisionEnvelope({ publicKey, body }: ProvisionEnvelopeProto): Uint8Array {
	return new ProtobufWriter().bytes(1, publicKey).bytes(2, body).finish();
}

export function decodeProvisionMessage(bytes: Uint8Array): ProvisionMessageProto {
	const message: ProvisionMessageProto = {};
	for (const field of readFields(bytes)) {
		switch (field.number) {
			case 2:
				message.aciIdentityKeyPrivate = asBytes(field);
				break;
			case 3:
				message.number = asString(field);
				break;
			case 4:
				message.provisioningCode = asString(field);
				break;
			case 8:
				message.aci = asString(field);
				break;
			case 10:
				message.pni = asString(field);
				break;
			case 12:
				message.pniIdentityKeyPrivate = asBytes(field);
				break;
			case 17:
				message.aciBinary = asBytes(field);
				break;
			case 18:
				message.pniBinary = asBytes(field);
				break;
		}
	}
	return message;
}

export function encodeProvisionMessage(message: ProvisionMessageProto): Uint8Array {
	return new ProtobufWriter()
		.bytes(2, message.aciIdentityKeyPrivate)
		.string(3, message.number)
		.string(4, message.provisioningCode)
		.string(8, message.aci)
		.string(10, message.pni)
		.bytes(12, message.pniIdentityKeyPrivate)
		.bytes(17, message.aciBinary)
		.bytes(18, message.pniBinary)
		.finish();
}

export function decodeDeviceName(bytes: Uint8Array): DeviceNameProto {
	const name: DeviceNameProto = {};
	for (const field of readFields(bytes)) {
		if (field.number === 1) {
			name.ephemeralPublic = asBytes(field);
		} else if (field.number === 2) {
			name.syntheticIv = asBytes(field);
		} else if (field.number === 3) {
			name.ciphertext = asBytes(field);
		}
	}
	return name;
}

export function encodeDeviceName({
	ephemeralPublic,
	syntheticIv,
	ciphertext,
}: DeviceNameProto): Uint8Array {
	return new ProtobufWriter()
		.bytes(1, ephemeralPublic)
		.bytes(2, syntheticIv)
		.bytes(3, ciphertext)
		.finish();
}
