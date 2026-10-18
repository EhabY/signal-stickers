<script lang="ts">
	import { tick } from "svelte";

	import type { Pack, StickerLimits, ValidationIssue } from "../lib/api.ts";
	import type { PackImageTarget } from "../lib/packSession.svelte.ts";
	import { showsStill } from "../lib/stillImage.ts";
	import Icon from "./Icon.svelte";
	import IssueList from "./IssueList.svelte";
	import PackImage from "./PackImage.svelte";
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
		/** Converts pack images, animations Signal does not animate, to animated PNGs in place. */
		onconvert: (targets: PackImageTarget[]) => void;
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
		onconvert,
	}: Props = $props();
	const id = $props.id();
	const titleIssues = $derived(issues.filter(({ code }) => code === "missingTitle"));
	const authorIssues = $derived(issues.filter(({ code }) => code === "missingAuthor"));
	const hasSeparateCover = $derived(!pack.stickers.some(({ file }) => file === pack.cover));
	const unsupportedAnimations: PackImageTarget[] = $derived([
		...pack.stickers.flatMap(({ file }, index) =>
			showsStill(issues, file) ? [{ index, file }] : [],
		),
		...(hasSeparateCover && showsStill(issues, pack.cover) ? [{ file: pack.cover }] : []),
	]);
	const firstSticker = $derived(pack.stickers.at(0));
	let coverInput: HTMLInputElement | undefined = $state();
	let addInput: HTMLInputElement | undefined = $state();
	let summaryStatus: HTMLElement | undefined = $state();
	let focusWhenEnabled: "cover" | "summary" | undefined;

	// Converting disables the editor and removes the Convert button clicked; focus what replaces it.
	$effect(() => {
		if (!disabled && focusWhenEnabled) {
			(focusWhenEnabled === "cover" ? coverInput : summaryStatus)?.focus();
			focusWhenEnabled = undefined;
		}
	});

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

	function convertCover(): void {
		focusWhenEnabled = "cover";
		onconvert([{ file: pack.cover }]);
	}

	function convertAll(): void {
		focusWhenEnabled = "summary";
		onconvert(unsupportedAnimations);
	}

	async function useFirstStickerAsCover(): Promise<void> {
		if (firstSticker) {
			onchange({ ...pack, cover: firstSticker.file });
			// The button disappears with the separate cover; keep focus on the cover controls.
			await tick();
			coverInput?.focus();
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
			<h3 tabindex="-1" bind:this={summaryStatus}>
				{issues.length === 1 ? "1 thing" : `${issues.length} things`} to fix before publishing
			</h3>
			<IssueList {issues} />
			{#if unsupportedAnimations.length > 1}
				<button type="button" class="convert-all" {disabled} onclick={convertAll}>
					Convert all to animated PNG
				</button>
			{/if}
		</div>
	{:else}
		<p class="ready" tabindex="-1" bind:this={summaryStatus}>Ready to publish.</p>
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
		<div class="field" role="group" aria-labelledby="{id}-cover">
			<span id="{id}-cover" class="label">Cover</span>
			<div class="cover">
				<PackImage
					src={imageUrl(pack.cover)}
					alt="Current cover"
					still={showsStill(issues, pack.cover)}
				/>
				<div class="cover-actions">
					<!-- One input for both states, so it keeps focus when the cover changes. -->
					<label class="file-button small" class:disabled>
						<input
							class="visually-hidden"
							type="file"
							accept="image/*"
							aria-label={hasSeparateCover ? "Replace the cover image" : "Upload a separate cover"}
							{disabled}
							onchange={chooseCover}
							bind:this={coverInput}
						/>
						{hasSeparateCover ? "Replace" : "Upload a separate cover"}
					</label>
					{#if hasSeparateCover}
						{#if showsStill(issues, pack.cover)}
							<button
								type="button"
								class="link"
								aria-label="Convert the cover to an animated PNG"
								{disabled}
								onclick={convertCover}
							>
								Convert to animated PNG
							</button>
						{/if}
						<button
							type="button"
							class="link"
							disabled={disabled || firstSticker === undefined}
							onclick={useFirstStickerAsCover}
						>
							Use a sticker instead
						</button>
					{:else}
						<span class="muted cover-hint"
							>or choose <strong>Set as cover</strong> on a sticker</span
						>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="toolbar">
		<div>
			<p class="count">{pack.stickers.length} / {limits.maxStickers} stickers</p>
			<p class="muted hint">
				Drag to reorder. Images are fitted to {limits.size}&times;{limits.size} under {Math.floor(
					limits.maxBytes / 1024,
				)} KiB; PNG and WebP that already fit are kept. Animations become animated PNG.
			</p>
		</div>
		<label class="file-button primary" class:disabled>
			<input
				class="visually-hidden"
				type="file"
				accept="image/*"
				multiple
				{disabled}
				onchange={addImages}
				bind:this={addInput}
			/>
			<Icon name="add" />
			Add images
		</label>
	</div>

	<StickerGrid
		{pack}
		{issues}
		{imageUrl}
		{disabled}
		{onchange}
		{onremove}
		onconvert={(index, file) => {
			onconvert([{ index, file }]);
		}}
		onempty={() => addInput?.focus()}
	/>
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

	.convert-all {
		margin-top: 0.6rem;
	}

	.ready {
		margin: 0;
		color: var(--success);
		font-weight: 600;
	}

	.details {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: 1rem 1.25rem;
		align-items: start;
	}

	.field {
		display: grid;
		gap: 0.3rem;
	}

	.label {
		font-weight: 600;
	}

	.cover {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.cover :global(img) {
		width: 64px;
		height: 64px;
		object-fit: contain;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-muted);
	}

	.cover-actions {
		display: grid;
		gap: 0.3rem;
		justify-items: start;
	}

	.cover-hint {
		font-size: 0.85rem;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
	}

	.link:hover:not(:disabled) {
		background: none;
		text-decoration: underline;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: space-between;
		align-items: center;
	}

	.toolbar p {
		margin: 0;
	}

	.count {
		font-weight: 600;
	}

	.hint {
		font-size: 0.85rem;
	}

	.file-button {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		cursor: pointer;
	}

	.file-button:not(.primary, .disabled):hover {
		background: var(--surface-muted);
	}

	.file-button.small {
		padding: 0.25rem 0.7rem;
		font-size: 0.9rem;
	}

	.file-button.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}

	.file-button.primary:hover:not(.disabled) {
		filter: brightness(1.08);
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
