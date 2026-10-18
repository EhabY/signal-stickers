export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Scales `image` to fit a `size` square, centered, keeping its aspect ratio. */
export function fitInSquare(
	image: Readonly<{ width: number; height: number }>,
	size: number,
): Rect {
	const scale = size / Math.max(image.width, image.height);
	const width = Math.round(image.width * scale);
	const height = Math.round(image.height * scale);
	return { x: Math.floor((size - width) / 2), y: Math.floor((size - height) / 2), width, height };
}
