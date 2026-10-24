<script lang="ts">
	import { onMount, tick } from "svelte";

	import AccountView from "./components/AccountView.svelte";
	import Editor from "./components/Editor.svelte";
	import ImportView from "./components/ImportView.svelte";
	import PublishView from "./components/PublishView.svelte";
	import {
		createApi,
		errorMessage,
		type Api,
		type PackResponse,
		type StatusResponse,
	} from "./lib/api.ts";
	import { connectEvents, LiveProgress, type ConnectEvents } from "./lib/events.svelte.ts";
	import {
		PackSession,
		type Conversion,
		type ConvertedAnimation,
	} from "./lib/packSession.svelte.ts";
	import { encodeSticker, type StickerEncoder } from "./lib/stickerImage.ts";

	type Props = { api?: Api; connect?: ConnectEvents; encode?: StickerEncoder };
	type View = "import" | "edit" | "publish" | "account";

	let { api = createApi(), connect = connectEvents, encode = encodeSticker }: Props = $props();
	const session = $derived(new PackSession(api, encode));
	const progress = new LiveProgress();
	let status: StatusResponse | undefined = $state.raw();
	let view: View = $state("import");
	let loadError: string | undefined = $state();
	let packError: string | undefined = $state();
	let conversionList: HTMLElement | undefined = $state();
	let editor: ReturnType<typeof Editor> | undefined = $state();

	const views: readonly { view: View; label: string; needsPack: boolean }[] = [
		{ view: "import", label: "Import", needsPack: false },
		{ view: "edit", label: "Edit", needsPack: true },
		{ view: "publish", label: "Publish", needsPack: true },
		{ view: "account", label: "Account", needsPack: false },
	];

	onMount(() => {
		void load();
		return connect((event) => {
			progress.apply(event);
		});
	});

	async function load(): Promise<void> {
		loadError = undefined;
		const [loadedStatus, pack] = await Promise.allSettled([api.getStatus(), api.getPack()]);
		if (loadedStatus.status === "rejected") {
			loadError = `Could not reach the signal-stickers server: ${errorMessage(loadedStatus.reason)}`;
			return;
		}
		status = loadedStatus.value;
		if (pack.status === "rejected") {
			packError = `Could not open the pack folder: ${errorMessage(pack.reason)}. Import a pack to replace it.`;
		} else if (pack.value) {
			showPulled(pack.value);
		}
	}

	function showPulled(response: PackResponse): void {
		session.load(response);
		showEditor();
	}

	function showEditor(): void {
		packError = undefined;
		view = "edit";
	}

	// The clicked Cancel goes away; focus the next one, or Add images when no conversion is left.
	async function cancelConversion(id: number, index: number): Promise<void> {
		session.conversions.cancel(id);
		await tick();
		const buttons = conversionList?.querySelectorAll("button") ?? [];
		const next = buttons[Math.min(index, buttons.length - 1)];
		if (next) {
			next.focus();
		} else {
			editor?.focusAddImages();
		}
	}

	function describeConversion({ file, waiting, progress: stage }: Conversion): string {
		if (stage === undefined) {
			return waiting ? `Waiting to convert ${file}` : `Converting ${file}`;
		}
		const step =
			stage.step === "decode"
				? `reading frame ${stage.done} of ${stage.total}`
				: `trying ${stage.size}×${stage.size}, ${stage.colors} colors, ${describeFps(stage.fps)}`;
		return `Converting ${file} to an animated PNG: ${step}`;
	}

	function describeConverted({ file, size, fps, bytes }: ConvertedAnimation): string {
		return `Converted ${file}: ${size}×${size}, ${describeFps(fps)}, ${Math.ceil(bytes / 1024)} KiB`;
	}

	function describeFps(fps: number): string {
		return `${Number(fps.toPrecision(2))} fps`;
	}

	function describeFlattened(files: readonly string[]): string {
		return `This browser cannot convert animations, so these became still images: ${files.join(", ")}. To keep them animated, update the browser and add them again.`;
	}
</script>

<a class="skip-link" href="#main">Skip to content</a>

<header>
	<div class="brand">
		<img class="app-mark" src="/favicon.svg" alt="" width="36" height="36" />
		<div class="brand-name">
			<h1>Signal Stickers</h1>
			{#if status}
				<span class="env" class:staging={status.env === "staging"}>Signal {status.env}</span>
			{/if}
		</div>
	</div>
	{#if status}
		<nav aria-label="Sections">
			{#each views as item (item.view)}
				<button
					type="button"
					aria-current={view === item.view ? "page" : undefined}
					disabled={item.needsPack && !session.pack}
					title={item.needsPack && !session.pack ? "Import a pack first" : undefined}
					onclick={() => (view = item.view)}
				>
					{item.label}
				</button>
			{/each}
		</nav>
	{/if}
</header>

<main id="main" tabindex="-1">
	{#if loadError !== undefined}
		<div class="alert" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={load}>Try again</button>
		</div>
	{:else if !status}
		<p class="muted" role="status">Loading…</p>
	{:else}
		<!-- Views stay mounted while hidden, so a running link, pull, or push and its outcome survive. -->
		<div class="view" hidden={view !== "import"}>
			{#if packError !== undefined}
				<p class="alert" role="alert">{packError}</p>
			{/if}
			<ImportView {session} {progress} onpulled={showEditor} />
		</div>
		{#if session.pack}
			{@const limits = status.limits}
			<div class="view" hidden={view !== "edit"}>
				{#if session.saveError !== undefined}
					<p class="alert" role="alert">{session.saveError}</p>
				{/if}
				{#if session.error !== undefined}
					<p class="alert" role="alert">{session.error}</p>
				{/if}
				{#if session.conversions.list.length > 0 || session.conversions.converted.length > 0}
					<div class="conversions" bind:this={conversionList}>
						{#each session.conversions.list as conversion, index (conversion.id)}
							<p class="conversion muted" role="status">
								{describeConversion(conversion)}
								<button
									type="button"
									aria-label="Cancel converting {conversion.file}"
									onclick={() => cancelConversion(conversion.id, index)}
								>
									Cancel
								</button>
							</p>
						{/each}
						{#each session.conversions.converted as converted (converted.id)}
							<p class="muted" role="status">{describeConverted(converted)}</p>
						{/each}
					</div>
				{/if}
				{#if session.flattened.length > 0}
					<p class="warning" role="status">{describeFlattened(session.flattened)}</p>
				{/if}
				<Editor
					bind:this={editor}
					pack={session.pack}
					issues={session.issues}
					{limits}
					imageUrl={(file) => api.stickerUrl(file, session.imageVersions.get(file))}
					converting={session.conversions.inPlace}
					disabled={session.locked}
					onchange={(pack) => {
						session.edit(pack);
					}}
					onadd={(images) => {
						void session.add(images, limits);
					}}
					onremove={(index, file) => {
						void session.remove(index, file);
					}}
					oncover={(image) => {
						void session.setCover(image, limits);
					}}
					onconvert={(targets) => {
						void session.convertAnimations(targets, limits);
					}}
				/>
			</div>
			<div class="view" hidden={view !== "publish"}>
				<PublishView {status} {session} {progress} onaccount={() => (view = "account")} />
			</div>
		{/if}
		<div class="view" hidden={view !== "account"}>
			<AccountView {api} {status} {progress} onstatus={(updated) => (status = updated)} />
		</div>
	{/if}
</main>

<style>
	header {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem 1.5rem;
		justify-content: space-between;
		align-items: center;
		padding: 0.9rem max(1rem, calc((100vw - 1100px) / 2));
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.brand {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.app-mark {
		flex: none;
	}

	.brand-name {
		display: grid;
		justify-items: start;
		gap: 0.25rem;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}

	.env {
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.env.staging {
		background: var(--warning-soft);
		color: var(--warning);
	}

	nav {
		justify-self: end;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg);
	}

	nav button {
		border-color: transparent;
		background: transparent;
	}

	nav button[aria-current="page"] {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}

	main {
		display: grid;
		gap: 1rem;
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
	}

	main .alert p {
		margin: 0 0 0.5rem;
	}

	.conversions {
		display: grid;
		gap: 1rem;
	}

	.conversion {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
	}

	.view {
		display: grid;
		gap: 1rem;
	}

	.view[hidden] {
		display: none;
	}

	@media (max-width: 760px) {
		header {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.75rem;
		}

		.brand {
			flex-wrap: nowrap;
			gap: 0.5rem;
		}

		h1 {
			font-size: 1.05rem;
		}

		.env {
			font-size: 0.75rem;
		}

		nav {
			grid-column: 1 / -1;
			width: 100%;
		}

		nav button {
			flex: 1;
			padding-inline: 0.5rem;
		}

		main {
			padding-top: 1rem;
		}
	}
</style>
