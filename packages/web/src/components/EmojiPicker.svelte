<script lang="ts">
	import emojiDataUrl from "emoji-picker-element-data/en/emojibase/data.json?url";
	import { onMount } from "svelte";

	import { isRecord } from "../lib/api.ts";

	type Props = { label: string; onpick: (emoji: string) => void; onclose: () => void };

	let { label, onpick, onclose }: Props = $props();
	let dialog: HTMLDialogElement | undefined = $state();
	let picker: HTMLElement | undefined = $state();
	let loadFailed = $state(false);

	onMount(() => {
		// A modal dialog keeps focus inside, makes the page behind it inert, and closes on Escape.
		dialog?.showModal();
		// Defines <emoji-picker>; loaded on first use to keep it out of the main bundle.
		import("emoji-picker-element").catch(() => {
			loadFailed = true;
		});
	});

	$effect(() => {
		const element = picker;
		if (!element) {
			return;
		}
		element.addEventListener("emoji-click", pick);
		return () => {
			element.removeEventListener("emoji-click", pick);
		};
	});

	function pick(event: Event): void {
		const emoji = event instanceof CustomEvent ? readUnicode(event.detail) : undefined;
		if (emoji !== undefined) {
			onpick(emoji);
		}
	}

	function readUnicode(detail: unknown): string | undefined {
		return isRecord(detail) && typeof detail.unicode === "string" ? detail.unicode : undefined;
	}
</script>

<dialog class="panel" aria-label={label} bind:this={dialog} {onclose}>
	<div class="header">
		<h3>{label}</h3>
		<button type="button" onclick={onclose}>Close</button>
	</div>
	{#if loadFailed}
		<p class="alert" role="alert">The emoji picker could not load.</p>
	{:else}
		<emoji-picker data-source={emojiDataUrl} bind:this={picker}></emoji-picker>
	{/if}
</dialog>

<style>
	dialog {
		padding: 1rem;
		color: inherit;
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 40%);
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.header h3 {
		margin: 0;
		font-size: 1rem;
	}

	emoji-picker {
		width: min(352px, 80vw);
		height: min(420px, 65vh);
	}
</style>
