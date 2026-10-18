import { vi } from "vitest";

/** The object URL every drawn image gets from {@link stubImageDrawing}. */
export const DRAWN_URL = "blob:drawn";

/**
 * Stubs what jsdom lacks to draw an image on a canvas: `fetch` for its bytes, `createImageBitmap`,
 * a 2D context, `toBlob`, and object URLs, which all resolve {@link DRAWN_URL}.
 */
export function stubImageDrawing() {
	const fetchImage = vi.fn<typeof fetch>(() => Promise.resolve(new Response("image")));
	const decodeImage = vi.fn<typeof createImageBitmap>(() =>
		Promise.resolve({ width: 2, height: 2, close: vi.fn<() => void>() }),
	);
	const revokeObjectURL = vi.fn<(url: string) => void>();
	vi.stubGlobal("fetch", fetchImage);
	vi.stubGlobal("createImageBitmap", decodeImage);
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		configurable: true,
		value: () => ({ drawImage: vi.fn<() => void>() }),
	});
	HTMLCanvasElement.prototype.toBlob = (callback, type) => {
		callback(new Blob([], { type: type ?? "image/png" }));
	};
	URL.createObjectURL = () => DRAWN_URL;
	URL.revokeObjectURL = revokeObjectURL;
	return { fetchImage, decodeImage, revokeObjectURL };
}
