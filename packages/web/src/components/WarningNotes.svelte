<script lang="ts">
	import type { ValidationIssue } from "../lib/api.ts";
	import { describeWarnings } from "../lib/issues.ts";

	let { warnings }: { warnings: readonly ValidationIssue[] } = $props();
</script>

{#each describeWarnings(warnings) as note (note)}
	<p class="warning">{note}</p>
{/each}
