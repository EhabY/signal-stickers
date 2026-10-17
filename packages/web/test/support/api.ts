import type { PackResponse, StatusResponse } from "@signal-stickers/server/api";
import { vi } from "vitest";

import type { Api, Pack, StickerLimits, ValidationIssue } from "../../src/lib/api.ts";

export const LIMITS: StickerLimits = {
	minStickers: 1,
	maxStickers: 200,
	size: 512,
	minAnimatedSize: 10,
	maxBytes: 300 * 1024,
};

export const CATS: Pack = {
	title: "Cats",
	author: "Ehab",
	cover: "001.png",
	stickers: [
		{ file: "001.png", emoji: "😀" },
		{ file: "002.png", emoji: "😺" },
		{ file: "003.webp" },
	],
};

export const UNLINKED: StatusResponse = {
	env: "production",
	link: { linked: false },
	limits: LIMITS,
};

export function packResponse(
	pack: Pack = CATS,
	issues: readonly ValidationIssue[] = [],
): PackResponse {
	return { pack, issues };
}

const NO_WORKING_COPY: PackResponse | undefined = undefined;

/** An {@link Api} of mocks that succeed with {@link CATS} and {@link UNLINKED}. */
export function fakeApi() {
	return {
		getStatus: vi.fn<Api["getStatus"]>(() => Promise.resolve(UNLINKED)),
		link: vi.fn<Api["link"]>(() => Promise.resolve(UNLINKED)),
		unlink: vi.fn<Api["unlink"]>(() => Promise.resolve(UNLINKED)),
		pull: vi.fn<Api["pull"]>(() => Promise.resolve(packResponse())),
		getPack: vi.fn<Api["getPack"]>(() => Promise.resolve(NO_WORKING_COPY)),
		savePack: vi.fn<Api["savePack"]>((pack) => Promise.resolve(packResponse(pack))),
		addSticker: vi.fn<Api["addSticker"]>(() =>
			Promise.resolve({ ...packResponse(), file: "004.webp" }),
		),
		removeSticker: vi.fn<Api["removeSticker"]>(() => Promise.resolve(packResponse())),
		push: vi.fn<Api["push"]>(() =>
			Promise.resolve({ link: "https://signal.art/addstickers/#pack_id=new" }),
		),
		stickerUrl: (file: string, version: number) => `/stickers/${file}?v=${version}`,
	} satisfies Api;
}

export function files(pack: Pack): string[] {
	return pack.stickers.map(({ file }) => file);
}
