import { randomUUID } from "node:crypto";

import { getEnvironmentConfig, type Environment } from "../env.ts";
import { isPackIdValid, redactPackId } from "../stickers/link.ts";
import { getBytes, request } from "./http.ts";
import { SIGNAL_CA } from "./signalCa.ts";

export type CdnClient = Readonly<{
	getManifest(packId: string, signal?: AbortSignal): Promise<Uint8Array>;
	getSticker(packId: string, stickerId: number, signal?: AbortSignal): Promise<Uint8Array>;
	/** POSTs `data` to the CDN root as the S3 multipart form `form` describes. */
	upload(form: UploadForm, data: Uint8Array, signal?: AbortSignal): Promise<void>;
}>;

/** One upload slot from `GET /v1/sticker/pack/form/{count}`, like libsignal's `S3UploadForm`. */
export type UploadForm = Readonly<{
	key: string;
	credential: string;
	acl: string;
	algorithm: string;
	date: string;
	policy: string;
	signature: string;
}>;

export type CdnClientOptions = Readonly<{ env: Environment; userAgent?: string }>;

// Stickers are capped at 300 KiB by the server; this only bounds memory.
const MAX_DOWNLOAD_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;
// Signal sets no timeout per upload; this still allows 300 KiB at 2.5 KB/s.
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_UPLOAD_RESPONSE_BYTES = 64 * 1024;

export function createCdnClient({
	env,
	userAgent = "signal-stickers",
}: CdnClientOptions): CdnClient {
	const { cdnUrl } = getEnvironmentConfig(env);

	const get = (packId: string, path: string, signal?: AbortSignal) => {
		if (!isPackIdValid(packId)) {
			return Promise.reject(new TypeError("Invalid sticker pack id"));
		}
		return getBytes(`${cdnUrl}/stickers/${packId}/${path}`, {
			ca: SIGNAL_CA,
			headers: { "User-Agent": userAgent },
			maxBytes: MAX_DOWNLOAD_BYTES,
			timeoutMs: TIMEOUT_MS,
			redactedUrl: `${cdnUrl}/stickers/${redactPackId(packId)}/${path}`,
			signal,
		});
	};

	return {
		getManifest: (packId, signal) => get(packId, "manifest.proto", signal),
		getSticker: (packId, stickerId, signal) => get(packId, `full/${stickerId}`, signal),
		upload: async (form, data, signal) => {
			const boundary = `----------------${randomUUID().replaceAll("-", "")}`;
			await request(`${cdnUrl}/`, {
				method: "POST",
				ca: SIGNAL_CA,
				headers: {
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
					"User-Agent": userAgent,
				},
				body: encodeUploadForm(form, data, boundary),
				maxBytes: MAX_UPLOAD_RESPONSE_BYTES,
				timeoutMs: UPLOAD_TIMEOUT_MS,
				redactedUrl: `${cdnUrl}/`,
				signal,
			});
		},
	};
}

const CRLF = "\r\n";

/** Lays out the multipart body exactly like `makePutParams` in Signal-Desktop's `WebAPI`. */
function encodeUploadForm(form: UploadForm, data: Uint8Array, boundary: string): Uint8Array {
	const field = (name: string, value: string) =>
		[`--${boundary}`, `Content-Disposition: form-data; name="${name}"${CRLF}`, value].join(CRLF);
	const start = [
		field("key", form.key),
		field("x-amz-credential", form.credential),
		field("acl", form.acl),
		field("x-amz-algorithm", form.algorithm),
		field("x-amz-date", form.date),
		field("policy", form.policy),
		field("x-amz-signature", form.signature),
		field("Content-Type", "application/octet-stream"),
		`--${boundary}`,
		'Content-Disposition: form-data; name="file"',
		`Content-Type: application/octet-stream${CRLF}${CRLF}`,
	].join(CRLF);
	return Buffer.concat([Buffer.from(start), data, Buffer.from(`${CRLF}--${boundary}--${CRLF}`)]);
}
