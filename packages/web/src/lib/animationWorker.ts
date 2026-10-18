import {
	serveConversions,
	type AnimationDecoder,
	type OpenDecoder,
} from "./animationConversion.ts";
import { fitInSquare } from "./square.ts";

/** Decodes with WebCodecs' ImageDecoder and draws frames on OffscreenCanvas. */
const openImageDecoder: OpenDecoder<ImageBitmap> = async (bytes, type) =>
	(await canDecode(type)) ? decodeWithImageDecoder(bytes, type) : undefined;

serveConversions(self, openImageDecoder);

async function canDecode(type: string): Promise<boolean> {
	return (
		typeof ImageDecoder !== "undefined" &&
		typeof OffscreenCanvas !== "undefined" &&
		(await ImageDecoder.isTypeSupported(type))
	);
}

async function decodeWithImageDecoder(
	bytes: ArrayBuffer,
	type: string,
): Promise<AnimationDecoder<ImageBitmap>> {
	const decoder = new ImageDecoder({ data: bytes, type });
	const bitmaps: ImageBitmap[] = [];
	const close = () => {
		decoder.close();
		for (const bitmap of bitmaps) {
			bitmap.close();
		}
	};
	try {
		await Promise.all([decoder.tracks.ready, decoder.completed]);
		const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
		const { image: first } = await decoder.decode({ frameIndex: 0 });
		const { displayWidth: width, displayHeight: height } = first;
		first.close();
		return {
			width,
			height,
			frameCount,
			async decode(index, size) {
				const { image } = await decoder.decode({ frameIndex: index });
				try {
					if (size === undefined) {
						return { duration: image.duration };
					}
					const bitmap = drawFitted(image, size);
					bitmaps.push(bitmap);
					return { duration: image.duration, image: bitmap };
				} finally {
					image.close();
				}
			},
			render: (images, size) => Promise.resolve(rgbaPixels(images, size)),
			close,
		};
	} catch (error) {
		close();
		throw error;
	}
}

function drawFitted(frame: VideoFrame, size: number): ImageBitmap {
	const canvas = new OffscreenCanvas(size, size);
	const { x, y, width, height } = fitInSquare(
		{ width: frame.displayWidth, height: frame.displayHeight },
		size,
	);
	context2d(canvas).drawImage(frame, x, y, width, height);
	return canvas.transferToImageBitmap();
}

function rgbaPixels(images: readonly ImageBitmap[], size: number): ArrayBuffer[] {
	const canvas = new OffscreenCanvas(size, size);
	const context = context2d(canvas, { willReadFrequently: true });
	return images.map((image) => {
		context.clearRect(0, 0, size, size);
		context.drawImage(image, 0, 0, size, size);
		return context.getImageData(0, 0, size, size).data.buffer;
	});
}

/** A 2D context that scales smoothly; the default quality aliases when shrinking a lot. */
function context2d(
	canvas: OffscreenCanvas,
	settings?: CanvasRenderingContext2DSettings,
): OffscreenCanvasRenderingContext2D {
	const context = canvas.getContext("2d", settings);
	if (!context) {
		throw new Error("The browser cannot draw images");
	}
	context.imageSmoothingQuality = "high";
	return context;
}
