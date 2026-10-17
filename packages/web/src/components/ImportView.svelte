<script lang="ts">
	import type { PackResponse } from "@signal-stickers/server/api";
	import { tick } from "svelte";

	import { errorMessage, type Api } from "../lib/api.ts";
	import type { LiveProgress } from "../lib/events.svelte.ts";
	import ConfirmDialog from "./ConfirmDialog.svelte";
	import ProgressBar from "./ProgressBar.svelte";

	type Props = {
		api: Api;
		progress: LiveProgress;
		/** The title of the pack being edited, which importing replaces. */
		packTitle: string | undefined;
		onpulled: (response: PackResponse) => void;
	};

	let { api, progress, packTitle, onpulled }: Props = $props();
	let link = $state("");
	let pulling = $state(false);
	let confirming = $state(false);
	let error: string | undefined = $state();
	let importButton: HTMLButtonElement | undefined = $state();

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (packTitle === undefined) {
			void pull();
		} else {
			confirming = true;
		}
	}

	async function cancel(): Promise<void> {
		confirming = false;
		await tick();
		importButton?.focus();
	}

	async function pull(): Promise<void> {
		confirming = false;
		pulling = true;
		progress.pull = undefined;
		error = undefined;
		try {
			onpulled(await api.pull(link.trim()));
			link = "";
		} catch (caught) {
			error = errorMessage(caught);
		} finally {
			pulling = false;
		}
		if (error !== undefined) {
			await tick();
			importButton?.focus();
		}
	}
</script>

<section class="panel" aria-labelledby="import-heading">
	<h2 id="import-heading">Import a pack</h2>
	<form onsubmit={submit}>
		<label for="import-link">Sticker pack link</label>
		<input
			id="import-link"
			type="url"
			required
			autocomplete="off"
			spellcheck="false"
			placeholder="https://signal.art/addstickers/#pack_id=…&pack_key=…"
			disabled={pulling}
			bind:value={link}
		/>
		<p class="muted">
			Copy it from Signal: open the pack, then share it.
			{#if packTitle !== undefined}Importing replaces the pack you are editing.{/if}
		</p>
		<button type="submit" class="primary" disabled={pulling} bind:this={importButton}>
			{pulling ? "Importing…" : "Import pack"}
		</button>
	</form>
	{#if pulling && progress.pull}
		<ProgressBar done={progress.pull.done} total={progress.pull.total} label="Downloaded" />
	{/if}
	{#if error !== undefined}
		<p class="alert" role="alert">{error}</p>
	{/if}
</section>

{#if confirming}
	<ConfirmDialog
		title={packTitle ? `Replace "${packTitle}"?` : "Replace the pack you are editing?"}
		message="Importing replaces the pack you are editing and the changes you made to it."
		confirmLabel="Replace"
		onconfirm={pull}
		oncancel={cancel}
	/>
{/if}

<style>
	section,
	form {
		display: grid;
		gap: 0.6rem;
	}

	form button {
		justify-self: start;
	}

	form p {
		margin: 0;
		font-size: 0.9rem;
	}
</style>
