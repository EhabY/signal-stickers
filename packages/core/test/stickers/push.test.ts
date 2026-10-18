import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { HttpError } from "../../src/net/http.ts";
import { parsePackLink } from "../../src/stickers/link.ts";
import { pullPack } from "../../src/stickers/pull.ts";
import { pushPack, type PushOptions, type PushProgress } from "../../src/stickers/push.ts";
import { PackValidationError, type ValidationIssue } from "../../src/stickers/validate.ts";
import {
	fakeChat,
	fakeUploadChat,
	memoryCdn,
	NEW_PACK_ID,
	stickerPng,
	stickerUploadForms,
	tempDir,
	validPack,
	writePackFolder,
	type FakeChat,
	type PackFixture,
} from "../support/index.ts";

async function push(fixture: PackFixture = validPack(), options: Partial<PushOptions> = {}) {
	const dir = await writePackFolder(fixture.pack, fixture.images);
	const chat = fakeUploadChat();
	const cdn = memoryCdn();
	const result = await pushPack({ dir, chat, cdn, ...options });
	return { chat, cdn, result };
}

function rejectUpload() {
	return Promise.reject(new HttpError("POST / failed with status 403", { status: 403 }));
}

function recordProgress() {
	const events: PushProgress[] = [];
	const onProgress = (event: PushProgress) => {
		events.push(event);
	};
	return { events, onProgress };
}

/** Records each warning's code and file, with how many requests `chat` had sent by then. */
function recordWarnings(chat: FakeChat) {
	const warnings: { code: string; file: string | undefined; requestsSent: number }[] = [];
	const onWarnings = (issues: readonly ValidationIssue[]) => {
		const requestsSent = chat.requests.length;
		warnings.push(...issues.map(({ code, file }) => ({ code, file, requestsSent })));
	};
	return { warnings, onWarnings };
}

describe("pushPack", () => {
	it("returns the link of the new pack", async () => {
		const { result } = await push();

		expect(result.locator.packId).toBe(NEW_PACK_ID);
		expect(result.locator.packKey).toMatch(/^[0-9a-f]{64}$/u);
		expect(parsePackLink(result.link)).toEqual(result.locator);
	});

	it("requests an upload form for each image", async () => {
		const { chat } = await push();

		expect(chat.requests).toMatchObject([{ method: "GET", path: "/v1/sticker/pack/form/2" }]);
	});

	it("uploads the manifest first, then each sticker into its own slot", async () => {
		const { cdn } = await push(validPack(5));

		expect(cdn.uploads.map(({ form }) => form.key)).toEqual([
			`stickers/${NEW_PACK_ID}/manifest.proto`,
			...[0, 1, 2, 3, 4].map((id) => `stickers/${NEW_PACK_ID}/full/${id}`),
		]);
	});

	it("uploads a pack that pulls back unchanged", async () => {
		const { pack, images } = validPack();
		const chat = fakeUploadChat();
		const { warnings, onWarnings } = recordWarnings(chat);
		const { cdn, result } = await push({ pack, images }, { chat, onWarnings });
		const dir = await tempDir();

		const pulled = await pullPack({ locator: result.locator, dir, cdn });

		expect(pulled).toEqual(pack);
		expect(warnings).toEqual([]);
		expect(await readFile(join(dir, "002.png"))).toEqual(Buffer.from(images["002.png"]!));
	});

	it("warns about stickers without an emoji before any request, then uploads them", async () => {
		const { pack, images } = validPack();
		const stickers = [{ file: "001.png" }, { file: "002.png", emoji: "" }];
		const chat = fakeUploadChat();
		const { warnings, onWarnings } = recordWarnings(chat);
		const fixture = { pack: { ...pack, stickers }, images };
		const { cdn, result } = await push(fixture, { chat, onWarnings });
		const dir = await tempDir();

		const pulled = await pullPack({ locator: result.locator, dir, cdn });

		expect(warnings).toEqual([
			{ code: "missingEmoji", file: "001.png", requestsSent: 0 },
			{ code: "missingEmoji", file: "002.png", requestsSent: 0 },
		]);
		expect(pulled.stickers).toEqual([{ file: "001.png" }, { file: "002.png" }]);
	});

	it("uploads a separate cover that pulls back as its own image", async () => {
		const { pack, images } = validPack();
		const cover = stickerPng(9);
		const { cdn, result } = await push({
			pack: { ...pack, cover: "cover.png" },
			images: { ...images, "cover.png": cover },
		});
		const dir = await tempDir();

		const pulled = await pullPack({ locator: result.locator, dir, cdn });

		expect(pulled.cover).toBe("cover.png");
		expect(await readFile(join(dir, "cover.png"))).toEqual(Buffer.from(cover));
	});

	it("reports progress for the manifest and each image", async () => {
		const progress = recordProgress();

		await push(validPack(), { onProgress: progress.onProgress });

		expect(progress.events).toEqual([
			{ done: 1, total: 3 },
			{ done: 2, total: 3 },
			{ done: 3, total: 3 },
		]);
	});

	it("uploads at most three images at a time", async () => {
		const cdn = memoryCdn();
		let active = 0;
		let peak = 0;
		const upload: typeof cdn.upload = async (form, data) => {
			active += 1;
			peak = Math.max(peak, active);
			await setTimeout(5);
			active -= 1;
			await cdn.upload(form, data);
		};

		await push(validPack(8), { cdn: { ...cdn, upload } });

		expect(peak).toBe(3);
	});

	it("rejects an invalid pack before any request", async () => {
		const { pack, images } = validPack();
		const dir = await writePackFolder({ ...pack, title: "" }, images);
		const chat = fakeUploadChat();
		const cdn = memoryCdn();

		const pushing = pushPack({ dir, chat, cdn });

		await expect(pushing).rejects.toThrow(PackValidationError);
		await expect(pushing).rejects.toMatchObject({ issues: [{ code: "missingTitle" }] });
		expect(chat.requests).toEqual([]);
		expect(cdn.uploads).toEqual([]);
	});

	it("refuses a pack with errors, still reporting its warnings apart from them", async () => {
		const { pack, images } = validPack();
		const stickers = [{ file: "001.png" }, { file: "002.png", emoji: "😀" }];
		const dir = await writePackFolder({ ...pack, title: "", stickers }, images);
		const chat = fakeUploadChat();
		const { warnings, onWarnings } = recordWarnings(chat);

		const pushing = pushPack({ dir, chat, cdn: memoryCdn(), onWarnings });

		await expect(pushing).rejects.toMatchObject({ issues: [{ code: "missingTitle" }] });
		expect(warnings).toEqual([{ code: "missingEmoji", file: "001.png", requestsSent: 0 }]);
	});

	it.each([
		["a malformed pack id", { packId: "../x" }],
		["too few slots", { stickers: [] }],
		["a slot without a signature", { manifest: { key: "stickers/x/manifest.proto" } }],
	])("rejects an upload form with %s before uploading", async (_, change) => {
		const chat = fakeChat(() => ({ ...stickerUploadForms(2), ...change }));
		const cdn = memoryCdn();

		await expect(push(validPack(), { chat, cdn })).rejects.toThrow(
			"GET /v1/sticker/pack/form/2 returned an invalid upload form",
		);
		expect(cdn.uploads).toEqual([]);
	});

	it("rejects when an upload fails", async () => {
		const cdn = { ...memoryCdn(), upload: rejectUpload };

		await expect(push(validPack(), { cdn })).rejects.toThrow(HttpError);
	});

	it("stops uploading when aborted", async () => {
		const controller = new AbortController();
		const cdn = memoryCdn();
		const abort = () => {
			controller.abort();
		};

		const pushing = push(validPack(), { cdn, signal: controller.signal, onProgress: abort });

		await expect(pushing).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
		expect(cdn.uploads.map(({ form }) => form.key)).toEqual([
			`stickers/${NEW_PACK_ID}/manifest.proto`,
		]);
	});
});
