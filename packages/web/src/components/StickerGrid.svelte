<script lang="ts">
	import { tick } from "svelte";

	import type { Pack, PackSticker, ValidationIssue } from "../lib/api.ts";
	import { showsStill } from "../lib/stillImage.ts";
	import EmojiPicker from "./EmojiPicker.svelte";
	import Icon from "./Icon.svelte";
	import IssueList from "./IssueList.svelte";
	import PackImage from "./PackImage.svelte";

	type Props = {
		pack: Pack;
		issues: readonly ValidationIssue[];
		imageUrl: (file: string) => string;
		disabled?: boolean;
		onchange: (pack: Pack) => void;
		onremove: (index: number, file: string) => void;
		/** Called after removing the last sticker, so the parent can place focus. */
		onempty: () => void;
	};

	let { pack, issues, imageUrl, disabled = false, onchange, onremove, onempty }: Props = $props();
	const id = $props.id();
	let dragFrom: number | undefined = $state();
	let dropAt: number | undefined = $state();
	let pickingFor: number | undefined = $state();
	let announcement = $state("");
	let list: HTMLOListElement | undefined = $state();
	let removedAt: number | undefined;

	type Control = "emoji" | "earlier" | "later" | "remove";

	// Removing disables the grid until the server answers; then focus the card now in that place.
	$effect(() => {
		if (disabled || removedAt === undefined) {
			return;
		}
		if (pack.stickers.length === 0) {
			onempty();
		} else {
			focusControl(Math.min(removedAt, pack.stickers.length - 1), "remove");
		}
		removedAt = undefined;
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
		removedAt = index;
		onremove(index, file);
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
		{@const isCover = pack.cover === sticker.file}
		{@const stickerIssues = issues.filter(({ file }) => file === sticker.file)}
		<li
			class="card"
			class:cover={isCover}
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
			<div class="frame">
				<PackImage
					src={imageUrl(sticker.file)}
					alt={isCover ? `Sticker ${number} (cover)` : `Sticker ${number}`}
					still={showsStill(issues, sticker.file)}
					draggable="false"
				/>
				{#if isCover}
					<span class="cover-badge">Cover</span>
				{:else}
					<button
						type="button"
						class="set-cover"
						aria-label="Use sticker {number} as the cover"
						{disabled}
						onclick={() => {
							void setCover(index, sticker.file);
						}}
					>
						Set as cover
					</button>
				{/if}
				<button
					type="button"
					class="emoji"
					class:empty={sticker.emoji === undefined}
					data-control="emoji"
					aria-label={emojiLabel(sticker, number)}
					aria-haspopup="dialog"
					title={sticker.emoji === undefined ? "Choose an emoji" : "Change the emoji"}
					{disabled}
					onclick={() => (pickingFor = index)}
				>
					{sticker.emoji ?? "+"}
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
		grid-template-columns: repeat(auto-fill, minmax(136px, 1fr));
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
		background: repeating-conic-gradient(var(--surface-muted) 0 25%, var(--surface) 0 50%) 0 0 /
			16px 16px;
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
		border-radius: 13px;
	}

	.cover-badge,
	.set-cover {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
	}

	.cover-badge {
		background: var(--accent);
		color: var(--accent-text);
	}

	.set-cover {
		border: 1px solid var(--accent);
		background: var(--surface);
		color: var(--accent);
		box-shadow: var(--shadow);
	}

	.set-cover:hover:not(:disabled) {
		background: var(--accent);
		color: var(--accent-text);
	}

	.emoji {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		min-width: 2.25rem;
		height: 2.25rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 1.2rem;
		line-height: 1;
		box-shadow: var(--shadow);
	}

	.emoji.empty {
		border: 2px dashed var(--danger);
		color: var(--danger);
	}

	.tools,
	.set-cover {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.tools {
		position: absolute;
		bottom: 0.4rem;
		left: 50%;
		display: flex;
		gap: 1px;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--shadow);
		transform: translateX(-50%);
	}

	/* Hidden buttons must not take clicks; touch screens always show them. */
	.card:hover :is(.tools, .set-cover),
	.card:has(:focus-visible) :is(.tools, .set-cover) {
		opacity: 1;
		pointer-events: auto;
	}

	@media (hover: none), (any-pointer: coarse) {
		.tools,
		.set-cover {
			opacity: 1;
			pointer-events: auto;
		}
	}

	.tools button {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: 0;
		border-radius: 999px;
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

	@media (prefers-reduced-motion: reduce) {
		.frame,
		.tools {
			transition: none;
		}
	}
</style>
