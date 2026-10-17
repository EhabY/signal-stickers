<script lang="ts">
	import { onMount } from "svelte";

	type Props = {
		title: string;
		message: string;
		confirmLabel: string;
		onconfirm: () => void;
		/** Also called when the browser closes the dialog, as on Escape. */
		oncancel: () => void;
	};

	let { title, message, confirmLabel, onconfirm, oncancel }: Props = $props();
	const id = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();

	onMount(() => {
		// A modal dialog keeps focus inside, makes the page behind it inert, and closes on Escape.
		dialog?.showModal();
	});
</script>

<dialog
	class="panel"
	aria-labelledby="{id}-title"
	aria-describedby="{id}-message"
	bind:this={dialog}
	onclose={oncancel}
>
	<h3 id="{id}-title">{title}</h3>
	<p id="{id}-message">{message}</p>
	<!-- Cancel comes first, so it has the initial focus and Enter does not confirm by accident. -->
	<div class="actions">
		<button type="button" onclick={oncancel}>Cancel</button>
		<button type="button" class="primary" onclick={onconfirm}>{confirmLabel}</button>
	</div>
</dialog>

<style>
	dialog {
		max-width: min(28rem, 90vw);
		color: inherit;
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 40%);
	}

	h3 {
		font-size: 1.05rem;
	}

	.actions {
		justify-content: flex-end;
	}
</style>
