<script lang="ts">
	import ConnectionNotice from "./ConnectionNotice.svelte";
	import TabHandoff from "./TabHandoff.svelte";

	type Props = { connected: boolean; busy: boolean; save: () => Promise<void>; reload: () => void };

	let { connected, busy, save, reload }: Props = $props();
</script>

<!-- Floats above the page, so a notice moves nothing. -->
<div class="notices">
	<ConnectionNotice {connected} />
	<TabHandoff {busy} {save} {reload} />
</div>

<style>
	.notices {
		position: fixed;
		inset: auto 1rem 1rem;
		z-index: 20;
		display: grid;
		gap: 0.5rem;
		max-width: 40rem;
		margin: 0 auto;
	}

	.notices > :global(*) {
		margin: 0;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
	}
</style>
