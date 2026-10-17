<script lang="ts">
	import { tick } from "svelte";

	import type { Pack, PackSticker, ValidationIssue } from "../lib/api.ts";
	import EmojiPicker from "./EmojiPicker.svelte";
	import IssueList from "./IssueList.svelte";

	type Props = {
		pack: Pack;
		issues: readonly ValidationIssue[];
		imageUrl: (file: string) => string;
		disabled?: boolean;
		onchange: (pack: Pack) => void;
		onremove: (file: string) => void;
	};

	let { pack, issues, imageUrl, disabled = false, onchange, onremove }: Props = $props();
	const id = $props.id();
	let dragFrom: number | undefined = $state();
	let dropAt: number | undefined = $state();
	let pickingFor: number | undefined = $state();
	let announcement = $state("");
	let list: HTMLOListElement | undefined = $state();

	type Control = "emoji" | "earlier" | "later";

	async function move(from: number, to: number, focus?: Control): Promise<void> {
		const stickers = [...pack.stickers];
		const [moved] = stickers.splice(from, 1);
		if (!moved || from === to) {
			return;
		}
		stickers.splice(to, 0, moved);
		onchange({ ...pack, stickers });
		announcement = `Moved sticker ${from + 1} to position ${to + 1}.`;
		if (focus) {
			// Moving the card drops its focus; keep it on the same control while that still applies.
			await tick();
			if (!focusControl(to, focus)) {
				focusControl(to, "emoji");
			}
		}
	}

	function setEmoji(index: number, emoji: string): void {
		const sticker = pack.stickers[index];
		if (sticker) {
			onchange({ ...pack, stickers: pack.stickers.with(index, { ...sticker, emoji }) });
		}
	}

	async function closePicker(): Promise<void> {
		const index = pickingFor;
		pickingFor = undefined;
		await tick();
		if (index !== undefined) {
			focusControl(index, "emoji");
		}
	}

	function focusControl(index: number, control: Control): boolean {
		const button = list?.children[index]?.querySelector(`[data-control="${control}"]`);
		if (button instanceof HTMLButtonElement && !button.disabled) {
			button.focus();
			return true;
		}
		return false;
	}

	function startDrag(event: DragEvent, index: number): void {
		dragFrom = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", String(index));
		}
	}

	function dragOver(event: DragEvent, index: number): void {
		if (dragFrom !== undefined) {
			event.preventDefault();
			dropAt = index;
		}
	}

	function drop(event: DragEvent, index: number): void {
		event.preventDefault();
		const from = dragFrom;
		endDrag();
		if (from !== undefined) {
			void move(from, index);
		}
	}

	function endDrag(): void {
		dragFrom = undefined;
		dropAt = undefined;
	}

	function issuesId(index: number): string {
		return `${id}-issues-${index}`;
	}

	function emojiLabel({ emoji }: PackSticker, number: number): string {
		return emoji === undefined
			? `Choose an emoji for sticker ${number}`
			: `Change the emoji ${emoji} of sticker ${number}`;
	}
</script>

<ol class="grid" aria-label="Stickers" bind:this={list}>
	<!-- Keyed by position, since stickers may share an image file. -->
	{#each pack.stickers as sticker, index (index)}
		{@const number = index + 1}
		{@const stickerIssues = issues.filter(({ file }) => file === sticker.file)}
		<li
			class="card"
			class:invalid={stickerIssues.length > 0}
			class:dragging={dragFrom === index}
			class:drop-target={dropAt === index && dragFrom !== index}
			draggable={!disabled}
			ondragstart={(event) => {
				startDrag(event, index);
			}}
			ondragover={(event) => {
				dragOver(event, index);
			}}
			ondrop={(event) => {
				drop(event, index);
			}}
			ondragend={endDrag}
			aria-describedby={stickerIssues.length > 0 ? issuesId(index) : undefined}
		>
			<img src={imageUrl(sticker.file)} alt="Sticker {number}" draggable="false" />
			<button
				type="button"
				class="emoji"
				class:empty={sticker.emoji === undefined}
				data-control="emoji"
				aria-label={emojiLabel(sticker, number)}
				aria-haspopup="dialog"
				{disabled}
				onclick={() => (pickingFor = index)}
			>
				{sticker.emoji ?? "+"}
			</button>
			<label class="cover">
				<input
					type="radio"
					name="{id}-cover"
					aria-label="Use sticker {number} as the cover"
					checked={pack.cover === sticker.file}
					{disabled}
					onchange={() => {
						onchange({ ...pack, cover: sticker.file });
					}}
				/>
				Cover
			</label>
			<div class="tools">
				<button
					type="button"
					data-control="earlier"
					aria-label="Move sticker {number} earlier"
					disabled={disabled || index === 0}
					onclick={() => {
						void move(index, index - 1, "earlier");
					}}>&larr;</button
				>
				<button
					type="button"
					data-control="later"
					aria-label="Move sticker {number} later"
					disabled={disabled || index === pack.stickers.length - 1}
					onclick={() => {
						void move(index, index + 1, "later");
					}}>&rarr;</button
				>
				<button
					type="button"
					class="danger"
					aria-label="Remove sticker {number}"
					{disabled}
					onclick={() => {
						onremove(sticker.file);
					}}>&times;</button
				>
			</div>
			{#if stickerIssues.length > 0}
				<IssueList issues={stickerIssues} id={issuesId(index)} />
			{/if}
		</li>
	{/each}
</ol>

<p class="visually-hidden" aria-live="polite">{announcement}</p>

{#if pickingFor !== undefined}
	{@const index = pickingFor}
	<EmojiPicker
		label="Emoji for sticker {index + 1}"
		onpick={(emoji) => {
			setEmoji(index, emoji);
			void closePicker();
		}}
		onclose={closePicker}
	/>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		position: relative;
		display: grid;
		align-content: start;
		gap: 0.4rem;
		padding: 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		cursor: grab;
	}

	.card.invalid {
		border-color: var(--danger);
	}

	.card.dragging {
		opacity: 0.4;
	}

	.card.drop-target {
		outline: 2px dashed var(--accent);
		outline-offset: 2px;
	}

	img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		border-radius: 6px;
		background: repeating-conic-gradient(var(--surface-muted) 0 25%, transparent 0 50%) 0 0 / 16px
			16px;
	}

	.emoji {
		position: absolute;
		top: 0.9rem;
		right: 0.9rem;
		min-width: 2.4rem;
		height: 2.4rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 1.3rem;
		line-height: 1;
		box-shadow: var(--shadow);
	}

	.emoji.empty {
		border: 2px dashed var(--danger);
		color: var(--danger);
	}

	.cover {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		font-weight: 500;
		font-size: 0.9rem;
	}

	.tools {
		display: flex;
		gap: 0.3rem;
	}

	.tools button {
		flex: 1;
		padding: 0.25rem;
	}

	.card :global(.issues) {
		font-size: 0.85rem;
	}
</style>
