<script lang="ts">
	import { toString as renderQr } from "qrcode";

	let { text, label }: { text: string; label: string } = $props();
	let src: string | undefined = $state();

	$effect(() => {
		let current = true;
		void render(text, () => current);
		return () => {
			current = false;
		};
	});

	async function render(value: string, isCurrent: () => boolean): Promise<void> {
		try {
			const svg = await renderQr(value, { type: "svg", margin: 2 });
			if (isCurrent()) {
				src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			}
		} catch {
			src = undefined;
		}
	}
</script>

{#if src}
	<img class="qr" {src} alt={label} width="240" height="240" />
{/if}

<style>
	.qr {
		display: block;
		border-radius: var(--radius);
		background: #ffffff;
	}
</style>
