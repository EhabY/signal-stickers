import { render } from "@testing-library/svelte";
import { vi } from "vitest";

import App from "../../src/App.svelte";
import type { EventHandlers } from "../../src/lib/events.svelte.ts";
import type { StickerEncoder } from "../../src/lib/stickerImage.ts";
import { fakeApi } from "./api.ts";

export function renderApp(
	api = fakeApi(),
	encode: StickerEncoder = vi.fn<StickerEncoder>((image) => Promise.resolve(image)),
) {
	const events: { handlers?: EventHandlers } = {};
	render(App, {
		api,
		encode,
		connect: (handlers: EventHandlers) => {
			events.handlers = handlers;
			return vi.fn<() => void>();
		},
	});
	return { api, events };
}
