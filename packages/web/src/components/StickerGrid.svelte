<script lang="ts">
	import { tick } from "svelte";

	import type { Pack, PackSticker, ValidationIssue } from "../lib/api.ts";
	import { findSticker } from "../lib/packChanges.ts";
	import { showsStill } from "../lib/stillImage.ts";
	import EmojiPicker from "./EmojiPicker.svelte";
	import Icon from "./Icon.svelte";
	import IssueList from "./IssueList.svelte";
	import PackImage from "./PackImage.svelte";

	type Props = {
		pack: Pack;
		/** The issues that stop a publish; warnings show in the summary instead. */
		errors: readonly ValidationIssue[];
		imageUrl: (file: string) => string;
		/** The pack images being converted in place. */
		converting?: readonly string[];
		disabled?: boolean;
		onchange: (pack: Pack) => void;
		onremove: (index: number, file: string) => void;
		/** Converts the sticker's image, an animation Signal does not animate, to an animated PNG. */
		onconvert: (index: number, file: string) => void;
		/** Called after removing the last sticker, so the parent can place focus. */
		onempty: () => void;
	};

	let {
		pack,
		errors,
		imageUrl,
		converting = [],
		disabled = false,
		onchange,
		onremove,
		onconvert,
		onempty,
	}: Props = $props();
	const id = $props.id();
	let dragging: StickerAt | undefined = $state();
	let dropAt: number | undefined = $state();
	let picking: StickerAt | undefined = $state();
	let announcement = $state("");
	let list: HTMLOListElement | undefined = $state();
	/** The removals not answered yet, the last one's index, and the pack's length when last seen. */
	let removing: { count: number; index: number; length: number } | undefined;
	// Answers may move the sticker the picker or a drag was started on.
	const dragFrom = $derived(dragging && findSticker(pack, dragging.index, dragging.file));
	const pickingFor = $derived(picking && findSticker(pack, picking.index, picking.file));

	type Control = "emoji" | "earlier" | "later" | "remove";
	type StickerAt = Readonly<{ index: number; file: string }>;

	// Removing the last card drops its focus once the server answers; focus the card now in its place.
	$effect(() => {
		const { length } = pack.stickers;
		if (removing === undefined || length >= removing.length) {
			return;
		}
		const count = removing.count - (removing.length - length);
		const { index } = removing;
		removing = count > 0 ? { count, index, length } : undefined;
		if (!lostFocus()) {
			return;
		}
		if (length === 0) {
			onempty();
		} else {
			focusControl(Math.min(index, length - 1), "remove");
		}
	});

	async function setCover(index: number, file: string): Promise<void> {
		onchange({ ...pack, cover: file });
		// The button becomes the "Cover" label, so keep focus on the same card.
		await tick();
		focusControl(index, "emoji");
	}

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

	function remove(index: number, file: string): void {
		removing = { count: (removing?.count ?? 0) + 1, index, length: pack.stickers.length };
		onremove(index, file);
	}

	/** Converting replaces the button with a note, so focus moves to the card's emoji. */
	function convert(index: number, file: string): void {
		focusControl(index, "emoji");
		onconvert(index, file);
	}

	function setEmoji(index: number, emoji: string): void {
		const sticker = pack.stickers[index];
		if (sticker) {
			onchange({ ...pack, stickers: pack.stickers.with(index, { ...sticker, emoji }) });
		}
	}

	async function closePicker(): Promise<void> {
		const index = pickingFor;
		picking = undefined;
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

	function lostFocus(): boolean {
		const focused = document.activeElement;
		return focused === null || focused === document.body || !focused.isConnected;
	}

	function startDrag(event: DragEvent, index: number, file: string): void {
		dragging = { index, file };
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
		dragging = undefined;
		dropAt = undefined;
	}

	function issuesId(index: number): string {
		return `${id}-issues-${index}`;
	}

	function emojiLabel({ emoji }: PackSticker, number: number): string {
		return emoji
			? `Change the emoji ${emoji} of sticker ${number}`
			: `Choose an emoji for sticker ${number}`;
	}
</script>

<ol class="grid" aria-label="Stickers" bind:this={list}>
	<!-- Keyed by position, since stickers may share an image file. -->
	{#each pack.stickers as sticker, index (index)}
		{@const number = index + 1}
		{@const isCover = pack.cover === sticker.file}
		{@const stickerIssues = errors.filter(({ file }) => file === sticker.file)}
		{@const unsupportedAnimation = showsStill(errors, sticker.file)}
		<li
			class="card"
			class:cover={isCover}
			class:invalid={stickerIssues.length > 0}
			class:dragging={dragFrom === index}
			class:drop-target={dropAt === index && dragFrom !== index}
			draggable={!disabled}
			ondragstart={(event) => {
				startDrag(event, index, sticker.file);
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
			<div class="frame">
				<PackImage
					src={imageUrl(sticker.file)}
					alt={isCover ? `Sticker ${number} (cover)` : `Sticker ${number}`}
					still={unsupportedAnimation}
					draggable="false"
				/>
				{#if isCover}
					<span class="cover-badge">Cover</span>
				{:else}
					<button
						type="button"
						class="set-cover"
						title="Use as cover"
						aria-label="Use sticker {number} as the cover"
						{disabled}
						onclick={() => {
							void setCover(index, sticker.file);
						}}
					>
						<Icon name="cover" />
					</button>
				{/if}
				<div class="controls">
					<button
						type="button"
						class="emoji"
						class:empty={!sticker.emoji}
						data-control="emoji"
						aria-label={emojiLabel(sticker, number)}
						aria-haspopup="dialog"
						title={sticker.emoji
							? "Change the emoji"
							: "No emoji, so Signal won't suggest this sticker while typing. Choose one."}
						{disabled}
						onclick={() => (picking = { index, file: sticker.file })}
					>
						{sticker.emoji || "+"}
					</button>
					<div class="tools">
						<button
							type="button"
							data-control="earlier"
							aria-label="Move sticker {number} earlier"
							title="Move earlier"
							disabled={disabled || index === 0}
							onclick={() => {
								void move(index, index - 1, "earlier");
							}}
						>
							<Icon name="earlier" />
						</button>
						<button
							type="button"
							data-control="later"
							aria-label="Move sticker {number} later"
							title="Move later"
							disabled={disabled || index === pack.stickers.length - 1}
							onclick={() => {
								void move(index, index + 1, "later");
							}}
						>
							<Icon name="later" />
						</button>
						<button
							type="button"
							class="remove"
							data-control="remove"
							aria-label="Remove sticker {number}"
							title="Remove"
							{disabled}
							onclick={() => {
								remove(index, sticker.file);
							}}
						>
							<Icon name="remove" />
						</button>
					</div>
				</div>
			</div>
			{#if stickerIssues.length > 0}
				<IssueList issues={stickerIssues} id={issuesId(index)} />
			{/if}
			{#if converting.includes(sticker.file)}
				<span class="converting muted">Converting…</span>
			{:else if unsupportedAnimation}
				<button
					type="button"
					class="convert"
					aria-label="Convert sticker {number} to an animated PNG"
					{disabled}
					onclick={() => {
						convert(index, sticker.file);
					}}
				>
					Convert to animated PNG
				</button>
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
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 156px), 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: grid;
		align-content: start;
		gap: 0.35rem;
		cursor: grab;
	}

	.card.dragging {
		opacity: 0.4;
	}

	.frame {
		position: relative;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		overflow: hidden;
		transition:
			box-shadow 0.15s,
			border-color 0.15s;
	}

	.card:hover .frame {
		box-shadow: var(--shadow);
	}

	.card.cover .frame {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent);
	}

	.card.invalid .frame {
		border-color: var(--danger);
		box-shadow: 0 0 0 2px var(--danger);
	}

	.card.drop-target .frame {
		outline: 2px dashed var(--accent);
		outline-offset: 4px;
	}

	.frame :global(img) {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		padding: 1rem;
		background: var(--surface-muted);
		border-radius: 13px 13px 0 0;
	}

	.controls {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 0.5rem 0.25rem;
		padding: 0.5rem;
		border-top: 1px solid var(--border);
		cursor: default;
	}

	.cover-badge,
	.set-cover {
		position: absolute;
		top: 0.5rem;
		border-radius: 8px;
	}

	.cover-badge {
		left: 0.5rem;
		padding: 0.25rem 0.6rem;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.set-cover {
		right: 0.5rem;
		display: grid;
		place-items: center;
		width: 32px;
		min-height: 32px;
		padding: 0;
		background: var(--surface);
		color: var(--text-muted);
	}

	.set-cover:hover:not(:disabled) {
		background: var(--accent);
		color: var(--accent-text);
	}

	.emoji {
		width: 36px;
		min-height: 36px;
		padding: 0;
		border-radius: 8px;
		font-size: 1.2rem;
		line-height: 1;
	}

	.emoji.empty {
		border: 2px dashed var(--warning);
		background: var(--warning-soft);
		color: var(--warning);
	}

	.emoji.empty:hover:not(:disabled) {
		background: var(--warning);
		color: var(--surface);
	}

	.tools {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.tools button {
		display: grid;
		place-items: center;
		width: 32px;
		min-height: 36px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
	}

	.tools button:hover:not(:disabled) {
		background: var(--surface-muted);
	}

	.tools .remove:hover:not(:disabled) {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.card :global(.issues) {
		font-size: 0.8rem;
	}

	.converting {
		font-size: 0.85rem;
	}

	.convert {
		justify-self: start;
		padding: 0.25rem 0.7rem;
		border-color: var(--accent);
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
	}

	@media (prefers-reduced-motion: reduce) {
		.frame {
			transition: none;
		}
	}
</style>
