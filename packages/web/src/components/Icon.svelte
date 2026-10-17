<script lang="ts" module>
	const PATHS = {
		add: "M12 5v14M5 12h14",
		earlier: "M15 18l-6-6 6-6",
		later: "M9 18l6-6-6-6",
		remove: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
	} as const;
</script>

<script lang="ts">
	let { name }: { name: keyof typeof PATHS } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
	<path d={PATHS[name]} />
</svg>

<style>
	svg {
		width: 1.15em;
		height: 1.15em;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
