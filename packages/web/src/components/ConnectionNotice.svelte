<script lang="ts">
	type Props = {
		connected: boolean;
		/** How long the connection stays down before the notice shows, so a blip shows nothing. */
		delayMs?: number;
	};

	const STOPPED =
		"Signal Stickers has stopped, so changes here are not saved. Start it again to keep editing.";

	let { connected, delayMs = 2000 }: Props = $props();
	let stopped = $state(false);

	$effect(() => {
		if (connected) {
			stopped = false;
		}
		const timer = connected
			? undefined
			: setTimeout(() => {
					stopped = true;
				}, delayMs);
		return () => {
			clearTimeout(timer);
		};
	});
</script>

{#if stopped}
	<p class="alert" role="alert">{STOPPED}</p>
{/if}
