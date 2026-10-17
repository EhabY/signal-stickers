<script lang="ts">
	let { done, total, label }: { done: number; total: number; label: string } = $props();
</script>

<div class="progress">
	<progress max={total} value={done} aria-label={label}></progress>
	<p class="muted" aria-live="polite">{label}: {done} of {total}</p>
</div>

<style>
	.progress {
		width: min(100%, 28rem);
	}

	.progress p {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}
</style>
