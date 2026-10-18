import type { ServerEvent } from "@signal-stickers/server/api";
import { render } from "@testing-library/svelte";
import { vi } from "vitest";

import App from "../../src/App.svelte";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { fakeApi } from "./api.ts";

export function renderApp(
	api = fakeApi(),
	encode: StickerEncoder = vi.fn<StickerEncoder>((image) => Promise.resolve(image)),
) {
	const events: { send?: (event: ServerEvent) => void } = {};
	render(App, {
		api,
		encode,
		connect: (onEvent: (event: ServerEvent) => void) => {
			events.send = onEvent;
			return vi.fn<() => void>();
		},
	});
	return { api, events };
}
