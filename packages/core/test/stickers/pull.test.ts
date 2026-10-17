import { writeFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { HttpError } from "../../src/net/http.ts";
import { DecryptionError } from "../../src/stickers/crypto.ts";
import { PackFormatError, readPack } from "../../src/stickers/pack.ts";
import {
	DirectoryNotEmptyError,
	MAX_STICKERS_PER_PACK,
	pullPack,
	type PullOptions,
	type PullProgress,
} from "../../src/stickers/pull.ts";
import {
	fakeCdn,
	PACK_KEY,
	PACK_LOCATOR,
	png,
	tempDir,
	type FakeCdnOptions,
	type StickerPackProto,
} from "../support/index.ts";

const MANIFEST: StickerPackProto = {
	title: "Cats",
	author: "Ehab",
	cover: { id: 1 },
	stickers: [
		{ id: 0, emoji: "😀" },
		{ id: 1, emoji: "😾" },
	],
};

async function pull(
	manifest: StickerPackProto,
	options: Partial<PullOptions> & FakeCdnOptions = {},
) {
	const { images, failingStickerId, ...pullOptions } = options;
	const dir = await tempDir();
	const cdn = fakeCdn(manifest, { images, failingStickerId });
	const pack = await pullPack({ locator: PACK_LOCATOR, dir, cdn, ...pullOptions });
	return { dir: pullOptions.dir ?? dir, cdn, pack };
}

function recordProgress() {
	const events: PullProgress[] = [];
	const onProgress = (event: PullProgress) => {
		events.push(event);
	};
	return { events, onProgress };
}

describe("pullPack", () => {
	it("writes each sticker in order with its emoji", async () => {
		const { dir, pack } = await pull(MANIFEST);

		expect(pack).toEqual({
			title: "Cats",
			author: "Ehab",
			cover: "002.png",
			stickers: [
				{ file: "001.png", emoji: "😀" },
				{ file: "002.png", emoji: "😾" },
			],
		});
		expect(await readPack(dir)).toEqual(pack);
		expect(await readFile(join(dir, "001.png"))).toEqual(Buffer.from(png(0)));
		expect(await readFile(join(dir, "002.png"))).toEqual(Buffer.from(png(1)));
	});

	it("downloads a cover that is not in the sticker list", async () => {
		const { dir, cdn, pack } = await pull({ ...MANIFEST, cover: { id: 5 } });

		expect(pack.cover).toBe("cover.png");
		expect(cdn.stickerRequests).toEqual([0, 1, 5]);
		expect(await readFile(join(dir, "cover.png"))).toEqual(Buffer.from(png(5)));
	});

	it("uses the first sticker when there is no cover", async () => {
		const { pack } = await pull({ stickers: MANIFEST.stickers });

		expect(pack).toMatchObject({ title: "", author: "", cover: "001.png" });
	});

	it("skips stickers without ids and keeps emoji optional", async () => {
		const { pack } = await pull({ stickers: [{ id: 0 }, { emoji: "😾" }] });

		expect(pack.stickers).toEqual([{ file: "001.png" }]);
	});

	it("names files by their image format", async () => {
		const images = [Buffer.from("RIFFsizeWEBP"), Buffer.from("?")];

		const { dir } = await pull(MANIFEST, { images });

		expect((await readdir(dir)).toSorted()).toEqual(["001.webp", "002.bin", "pack.json"]);
	});

	it("reports progress including a distinct cover", async () => {
		const progress = recordProgress();

		await pull({ ...MANIFEST, cover: { id: 5 } }, { onProgress: progress.onProgress });

		expect(progress.events).toEqual([
			{ done: 1, total: 3 },
			{ done: 2, total: 3 },
			{ done: 3, total: 3 },
		]);
	});

	it("rejects an unknown pack", async () => {
		const locator = { packId: "00".repeat(16), packKey: PACK_KEY };

		await expect(pull(MANIFEST, { locator })).rejects.toThrow(HttpError);
	});

	it.each([
		["no stickers", [{ emoji: "😀" }]],
		["too many stickers", Array.from({ length: MAX_STICKERS_PER_PACK + 1 }, (_, id) => ({ id }))],
	])("rejects a pack with %s before downloading images", async (_, stickers) => {
		const cdn = fakeCdn({ stickers });

		await expect(pull({ stickers }, { cdn })).rejects.toThrow(PackFormatError);
		expect(cdn.stickerRequests).toEqual([]);
	});

	it("rejects content that does not decrypt", async () => {
		const cdn = { ...fakeCdn(MANIFEST), getManifest: () => Promise.resolve(new Uint8Array(64)) };

		await expect(pull(MANIFEST, { cdn })).rejects.toThrow(DecryptionError);
	});

	it("refuses to write into a non-empty folder", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "keep.txt"), "mine");

		await expect(pull(MANIFEST, { dir })).rejects.toThrow(DirectoryNotEmptyError);
		expect(await readdir(dir)).toEqual(["keep.txt"]);
	});

	it("leaves a file that appears in the folder during the pull alone", async () => {
		const dir = await tempDir();
		const intrude = () => {
			writeFileSync(join(dir, "001.png"), "mine");
		};

		await expect(pull(MANIFEST, { dir, onProgress: intrude })).rejects.toThrow(
			DirectoryNotEmptyError,
		);
		expect(await readdir(dir)).toEqual(["001.png"]);
		expect(await readFile(join(dir, "001.png"), "utf8")).toBe("mine");
	});

	it("leaves a file that appears at the folder's path during the pull alone", async () => {
		const dir = join(await tempDir(), "pack");
		const intrude = () => {
			writeFileSync(dir, "mine");
		};

		await expect(pull(MANIFEST, { dir, onProgress: intrude })).rejects.toThrow(
			expect.objectContaining({ code: "EEXIST" }),
		);
		expect(await readFile(dir, "utf8")).toBe("mine");
	});

	it("writes through a link to an empty folder", async () => {
		const parent = await tempDir();
		const real = join(parent, "real");
		const link = join(parent, "link");
		await mkdir(real);
		await symlink(real, link, "junction");

		await pull(MANIFEST, { dir: link });

		expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect((await readdir(real)).toSorted()).toEqual(["001.png", "002.png", "pack.json"]);
	});

	it("stops reporting progress and writes nothing after a download fails", async () => {
		const dir = join(await tempDir(), "pack");
		const progress = recordProgress();
		const failsFirst = fakeCdn(MANIFEST, { failingStickerId: 0 });
		const cdn = {
			...failsFirst,
			getSticker: async (packId: string, id: number) => {
				await setTimeout(id * 20);
				return failsFirst.getSticker(packId, id);
			},
		};

		await expect(pull(MANIFEST, { dir, cdn, onProgress: progress.onProgress })).rejects.toThrow(
			HttpError,
		);
		await setTimeout(50);

		expect(progress.events).toEqual([]);
		expect(await readdir(dirname(dir))).toEqual([]);
	});

	it("stops and writes nothing when aborted", async () => {
		const controller = new AbortController();
		const dir = join(await tempDir(), "pack");
		const abort = () => {
			controller.abort();
		};

		const pulling = pull(MANIFEST, { dir, signal: controller.signal, onProgress: abort });

		await expect(pulling).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
		expect(await readdir(dirname(dir))).toEqual([]);
	});
});
