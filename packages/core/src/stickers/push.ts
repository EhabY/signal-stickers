import type { CdnClient, UploadForm } from "../net/cdn.ts";
import type { ChatClient } from "../net/chat.ts";
import { HttpError } from "../net/http.ts";
import { strictAssert } from "../util/assert.ts";
import { isRecord } from "../util/isRecord.ts";
import { mapConcurrent } from "../util/mapConcurrent.ts";
import { encryptPack } from "./encryptPack.ts";
import { buildPackLink, isPackIdValid, type PackLocator } from "./link.ts";
import { PackValidationError, validatePack } from "./validate.ts";
import { readPackFolder } from "./validateFolder.ts";

/** Finished uploads out of all of them, the manifest included. */
export type PushProgress = Readonly<{ done: number; total: number }>;

export type PushOptions = Readonly<{
	/** A pack folder as `pullPack` writes it. */
	dir: string;
	/** Authenticated as the linked device, e.g. with `getChatAuth`. */
	chat: ChatClient;
	cdn: CdnClient;
	signal?: AbortSignal | undefined;
	onProgress?: ((progress: PushProgress) => void) | undefined;
}>;

export type PushResult = Readonly<{ locator: PackLocator; link: string }>;

const UPLOAD_CONCURRENCY = 3;

/**
 * Uploads the pack in `dir` as a new pack under a fresh random key and returns its link. Throws
 * `PackValidationError` before any request when the pack is invalid.
 */
export async function pushPack({
	dir,
	chat,
	cdn,
	signal,
	onProgress,
}: PushOptions): Promise<PushResult> {
	const { pack, images, oversizedImages } = await readPackFolder(dir);
	const issues = validatePack(pack, images, oversizedImages);
	if (issues.length > 0) {
		throw new PackValidationError(issues);
	}
	const encrypted = encryptPack(pack, images);

	const form = await getUploadForm(chat, encrypted.images.length, signal);
	let done = 0;
	const uploaded = () => {
		done += 1;
		onProgress?.({ done, total: encrypted.images.length + 1 });
	};
	await cdn.upload(form.manifest, encrypted.manifest, signal);
	uploaded();
	await mapConcurrent(
		encrypted.images,
		UPLOAD_CONCURRENCY,
		async (data, index, stop) => {
			// Slots pair with images by position, as in Signal-Desktop's `putStickers`.
			const slot = form.stickers[index];
			strictAssert(slot !== undefined, "the form has a slot per image");
			await cdn.upload(slot, data, stop);
			stop.throwIfAborted();
			uploaded();
		},
		signal,
	);

	const locator = { packId: form.packId, packKey: encrypted.packKey };
	return { locator, link: buildPackLink(locator) };
}

type StickerUploadForm = Readonly<{ packId: string; manifest: UploadForm; stickers: UploadForm[] }>;

async function getUploadForm(
	chat: ChatClient,
	count: number,
	signal: AbortSignal | undefined,
): Promise<StickerUploadForm> {
	const path = `/v1/sticker/pack/form/${count}`;
	const form = parseUploadForm(await chat.requestJson({ method: "GET", path, signal }));
	if (form?.stickers.length !== count) {
		throw new HttpError(`GET ${path} returned an invalid upload form`);
	}
	return form;
}

function parseUploadForm(value: unknown): StickerUploadForm | undefined {
	if (!isRecord(value) || !isPackIdValid(value.packId) || !Array.isArray(value.stickers)) {
		return undefined;
	}
	const manifest = parseUploadSlot(value.manifest);
	const stickers = value.stickers.map((slot: unknown) => parseUploadSlot(slot));
	if (!manifest || !stickers.every((slot) => slot !== undefined)) {
		return undefined;
	}
	return { packId: value.packId, manifest, stickers };
}

function parseUploadSlot(value: unknown): UploadForm | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const { key, credential, acl, algorithm, date, policy, signature } = value;
	if (
		typeof key !== "string" ||
		typeof credential !== "string" ||
		typeof acl !== "string" ||
		typeof algorithm !== "string" ||
		typeof date !== "string" ||
		typeof policy !== "string" ||
		typeof signature !== "string"
	) {
		return undefined;
	}
	return { key, credential, acl, algorithm, date, policy, signature };
}
