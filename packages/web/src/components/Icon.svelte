<script lang="ts" module>
	const PATHS = {
		add: "M12 5v14M5 12h14",
		theme:
			"M16 12a4 4 0 11-8 0 4 4 0 018 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
		cover:
			"M8 4h8a4 4 0 014 4v8a4 4 0 01-4 4H8a4 4 0 01-4-4V8a4 4 0 014-4zM4 14l5-5 11 11M14 9h.01",
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
