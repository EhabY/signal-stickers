<script lang="ts">
	import Icon from "./Icon.svelte";

	let theme = $state(readTheme());

	function readTheme(): string {
		try {
			const saved = localStorage.getItem("theme");
			if (saved === "light" || saved === "dark") {
				return saved;
			}
		} catch {
			// Theme selection still works when browser storage is unavailable.
		}
		return "system";
	}

	$effect(() => {
		document.documentElement.dataset.theme = theme;
	});

	function change(event: Event & { currentTarget: HTMLSelectElement }): void {
		theme = event.currentTarget.value;
		try {
			localStorage.setItem("theme", theme);
		} catch {
			// Keep the selection for this session when it cannot be saved.
		}
	}
</script>

<div class="theme-switch" title="Color theme">
	<Icon name="theme" />
	<select aria-label="Theme" value={theme} onchange={change}>
		<option value="system">System</option>
		<option value="light">Light</option>
		<option value="dark">Dark</option>
	</select>
</div>

<style>
	.theme-switch {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-left: 0.65rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-muted);
	}

	select {
		min-height: 44px;
		max-width: 100%;
		padding: 0.5rem 0.65rem;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		font-size: 0.85rem;
	}
</style>
