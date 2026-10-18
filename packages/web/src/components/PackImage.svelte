<script lang="ts">
	import type { HTMLImgAttributes } from "svelte/elements";

	import { firstFrameUrl } from "../lib/stillImage.ts";

	type Props = Omit<HTMLImgAttributes, "src" | "alt"> & {
		src: string;
		alt: string;
		/** Shows only the first frame, for an animation Signal does not animate. */
		still?: boolean;
	};

	let { src, alt, still = false, ...attributes }: Props = $props();
	let stillUrl: string | undefined = $state();

	$effect(() => {
		if (!still) {
			return;
		}
		const controller = new AbortController();
		void showFirstFrame(src, controller.signal);
		return () => {
			controller.abort();
			stillUrl = undefined;
		};
	});

	/** Shows the first frame of `url` until `signal` aborts, or the image as it is if that fails. */
	async function showFirstFrame(url: string, signal: AbortSignal): Promise<void> {
		try {
			const frame = await firstFrameUrl(url, signal);
			if (signal.aborted) {
				URL.revokeObjectURL(frame);
				return;
			}
			stillUrl = frame;
			signal.addEventListener("abort", () => {
				URL.revokeObjectURL(frame);
			});
		} catch {
			if (!signal.aborted) {
				stillUrl = url;
			}
		}
	}
</script>

<img {...attributes} src={still ? stillUrl : src} {alt} />
