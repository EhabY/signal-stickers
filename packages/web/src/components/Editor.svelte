<script lang="ts">
	import type { Pack, StickerLimits, ValidationIssue } from "../lib/api.ts";
	import IssueList from "./IssueList.svelte";
	import StickerGrid from "./StickerGrid.svelte";

	type Props = {
		pack: Pack;
		issues: readonly ValidationIssue[];
		limits: StickerLimits;
		imageUrl: (file: string) => string;
		disabled?: boolean;
		onchange: (pack: Pack) => void;
		onadd: (images: File[]) => void;
		onremove: (index: number, file: string) => void;
		oncover: (image: File) => void;
	};

	let {
		pack,
		issues,
		limits,
		imageUrl,
		disabled = false,
		onchange,
		onadd,
		onremove,
		oncover,
	}: Props = $props();
	const id = $props.id();
	const titleIssues = $derived(issues.filter(({ code }) => code === "missingTitle"));
	const authorIssues = $derived(issues.filter(({ code }) => code === "missingAuthor"));
	const hasSeparateCover = $derived(!pack.stickers.some(({ file }) => file === pack.cover));

	type FileInputEvent = Event & { currentTarget: HTMLInputElement };

	function addImages(event: FileInputEvent): void {
		const images = takeFiles(event);
		if (images.length > 0) {
			onadd(images);
		}
	}

	function chooseCover(event: FileInputEvent): void {
		const [image] = takeFiles(event);
		if (image) {
			oncover(image);
		}
	}

	/** Clears the input, so choosing the same file again still fires `change`. */
	function takeFiles({ currentTarget: input }: FileInputEvent): File[] {
		const images = [...(input.files ?? [])];
		input.value = "";
		return images;
	}
</script>

<section class="editor" aria-labelledby="{id}-heading">
	<h2 id="{id}-heading">Edit pack</h2>

	{#if issues.length > 0}
		<div class="summary">
			<h3>
				{issues.length === 1 ? "1 thing" : `${issues.length} things`} to fix before publishing
			</h3>
			<IssueList {issues} />
		</div>
	{:else}
		<p class="ready">Ready to publish.</p>
	{/if}

	<div class="details panel">
		<div class="field">
			<label for="{id}-title">Title</label>
			<input
				id="{id}-title"
				type="text"
				value={pack.title}
				{disabled}
				aria-invalid={titleIssues.length > 0}
				aria-describedby={titleIssues.length > 0 ? `${id}-title-issues` : undefined}
				oninput={(event) => {
					onchange({ ...pack, title: event.currentTarget.value });
				}}
			/>
			{#if titleIssues.length > 0}
				<IssueList issues={titleIssues} id="{id}-title-issues" />
			{/if}
		</div>
		<div class="field">
			<label for="{id}-author">Author</label>
			<input
				id="{id}-author"
				type="text"
				value={pack.author}
				{disabled}
				aria-invalid={authorIssues.length > 0}
				aria-describedby={authorIssues.length > 0 ? `${id}-author-issues` : undefined}
				oninput={(event) => {
					onchange({ ...pack, author: event.currentTarget.value });
				}}
			/>
			{#if authorIssues.length > 0}
				<IssueList issues={authorIssues} id="{id}-author-issues" />
			{/if}
		</div>
		<div class="cover">
			<img src={imageUrl(pack.cover)} alt="Cover" />
			<div>
				<p class="muted">
					{#if hasSeparateCover}
						This pack has a separate cover image. To use a sticker instead, choose
						<strong>Cover</strong> on it.
					{:else}
						The cover is a sticker. Choose another with <strong>Cover</strong> on a sticker.
					{/if}
				</p>
				<label class="file-button" class:disabled>
					<input
						class="visually-hidden"
						type="file"
						accept="image/*"
						{disabled}
						onchange={chooseCover}
					/>
					{hasSeparateCover ? "Replace the cover image" : "Use a separate image as the cover"}
				</label>
			</div>
		</div>
	</div>

	<div class="toolbar">
		<p class="muted">
			{pack.stickers.length} of {limits.maxStickers} stickers. Drag them, or use the arrows, to reorder.
		</p>
		<label class="file-button primary" class:disabled>
			<input
				class="visually-hidden"
				type="file"
				accept="image/*"
				multiple
				{disabled}
				onchange={addImages}
			/>
			Add images
		</label>
	</div>
	<p class="muted hint">
		Added images become {limits.size}&times;{limits.size} WebP under {Math.floor(
			limits.maxBytes / 1024,
		)} KiB. PNG and WebP images that already fit are kept as they are, animations included.
	</p>

	<StickerGrid {pack} {issues} {imageUrl} {disabled} {onchange} {onremove} />
</section>

<style>
	.editor {
		display: grid;
		gap: 1rem;
	}

	.editor h2 {
		margin: 0;
	}

	.summary {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--danger-soft);
	}

	.summary h3 {
		font-size: 1rem;
		color: var(--danger);
	}

	.ready {
		margin: 0;
		color: var(--success);
		font-weight: 600;
	}

	.details {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 1rem;
		align-items: start;
	}

	.field {
		display: grid;
		gap: 0.3rem;
	}

	.cover {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		max-width: 22rem;
	}

	.cover img {
		width: 72px;
		height: 72px;
		object-fit: contain;
		border-radius: 6px;
		background: var(--surface-muted);
	}

	.cover > div {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
	}

	.cover p {
		margin: 0;
		font-size: 0.9rem;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: space-between;
		align-items: center;
	}

	.toolbar p,
	.hint {
		margin: 0;
	}

	.hint {
		font-size: 0.85rem;
	}

	.file-button {
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		cursor: pointer;
	}

	.file-button.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}

	.file-button:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.file-button.disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	@media (max-width: 760px) {
		.details {
			grid-template-columns: 1fr;
		}
	}
</style>
