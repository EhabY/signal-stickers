import type { ValidationIssue } from "./api.ts";
import { encodeCanvas, StickerImageError } from "./stickerImage.ts";

/** Whether `file` is an animation Signal does not animate, so the editor shows only its first frame. */
export function showsStill(issues: readonly ValidationIssue[], file: string): boolean {
	return issues.some((issue) => issue.code === "unsupportedAnimation" && issue.file === file);
}

/** Draws the first frame of the image at `url` as a PNG and resolves its object URL to revoke. */
export async function firstFrameUrl(url: string, signal: AbortSignal): Promise<string> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new StickerImageError(`Could not load ${url}: ${response.status}`);
	}
	const bitmap = await createImageBitmap(await response.blob());
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new StickerImageError("The browser cannot draw images");
		}
		context.drawImage(bitmap, 0, 0);
		return URL.createObjectURL(await encodeCanvas(canvas, "image/png"));
	} finally {
		bitmap.close();
	}
}
