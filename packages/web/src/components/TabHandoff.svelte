<script lang="ts">
	import { onMount } from "svelte";

	type Props = {
		/** Whether closing this tab would cancel a task. */
		busy: boolean;
		/** Saves pending edits before this tab closes; rejecting keeps it open. */
		save: () => Promise<void>;
		/** Loads the edits an older tab saved after this one loaded. */
		reload: () => void;
	};

	type Message = "opened" | "saved";

	let { busy, save, reload }: Props = $props();
	let replaced = $state(false);
	let channel: BroadcastChannel | undefined;

	// Each launch of the app opens a new tab, so the older ones give way to it.
	onMount(() => {
		// Older browsers lack BroadcastChannel and keep every tab.
		if (typeof BroadcastChannel === "function") {
			channel = new BroadcastChannel("signal-stickers-editor");
			channel.addEventListener("message", ({ data }: MessageEvent<Message>) => {
				if (data === "opened") {
					void giveWay();
				} else {
					reload();
				}
			});
			send("opened");
		}
		return () => {
			channel?.close();
		};
	});

	function send(message: Message): void {
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- A BroadcastChannel has no target origin.
		channel?.postMessage(message);
	}

	async function giveWay(): Promise<void> {
		if (!busy) {
			try {
				await save();
				// The newer tab loaded before this one saved.
				send("saved");
				window.close();
			} catch {
				// The save failed, so the edits stay in this tab.
			}
		}
		// Still open: busy, unsaved, or the browser keeps tabs with history.
		replaced = true;
	}

	function editHere(): void {
		replaced = false;
		send("opened");
	}
</script>

{#if replaced}
	<div class="warning" role="status">
		<p>The editor is open in another tab. Edit there, or here instead.</p>
		<button type="button" onclick={editHere}>Edit here</button>
	</div>
{/if}

<style>
	p {
		margin: 0 0 0.5rem;
	}
</style>
