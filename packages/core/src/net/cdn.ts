import { getEnvironmentConfig, type Environment } from "../env.ts";
import { isPackIdValid, redactPackId } from "../stickers/link.ts";
import { NotImplementedError } from "../util/notImplemented.ts";
import { getBytes } from "./http.ts";
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
		upload: () => Promise.reject(new NotImplementedError("CdnClient.upload")),
	};
}
