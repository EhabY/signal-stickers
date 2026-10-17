<script lang="ts">
	import type { PackResponse } from "@signal-stickers/server/api";

	import { errorMessage, type Api } from "../lib/api.ts";
	import type { LiveProgress } from "../lib/events.svelte.ts";
	import ProgressBar from "./ProgressBar.svelte";

	type Props = {
		api: Api;
		progress: LiveProgress;
		/** Whether importing replaces a pack being edited. */
		hasPack: boolean;
		onpulled: (response: PackResponse) => void;
	};

	let { api, progress, hasPack, onpulled }: Props = $props();
	let link = $state("");
	let pulling = $state(false);
	let error: string | undefined = $state();

	async function pull(event: SubmitEvent): Promise<void> {
		event.preventDefault();
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
	}
</script>

<section class="panel" aria-labelledby="import-heading">
	<h2 id="import-heading">Import a pack</h2>
	<form onsubmit={pull}>
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
			{#if hasPack}Importing replaces the pack you are editing.{/if}
		</p>
		<button type="submit" class="primary" disabled={pulling}>
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
