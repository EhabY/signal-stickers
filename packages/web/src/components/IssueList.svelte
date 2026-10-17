<script lang="ts">
	import type { ValidationIssue } from "../lib/api.ts";

	let { issues, id }: { issues: readonly ValidationIssue[]; id?: string } = $props();
</script>

<ul class="issues" {id}>
	{#each issues as issue (`${issue.code}:${issue.file ?? ""}:${issue.message}`)}
		<li>{issue.message}</li>
	{/each}
</ul>

<style>
	.issues {
		margin: 0;
		padding-left: 1.2rem;
		color: var(--danger);
	}
</style>
