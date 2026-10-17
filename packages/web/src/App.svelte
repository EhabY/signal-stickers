<script lang="ts">
	import type { PackResponse, StatusResponse } from "@signal-stickers/server/api";
	import { onMount } from "svelte";

	import AccountView from "./components/AccountView.svelte";
	import Editor from "./components/Editor.svelte";
	import ImportView from "./components/ImportView.svelte";
	import PublishView from "./components/PublishView.svelte";
	import { createApi, errorMessage, type Api } from "./lib/api.ts";
	import { connectEvents, LiveProgress, type ConnectEvents } from "./lib/events.svelte.ts";
	import { PackSession } from "./lib/packSession.svelte.ts";
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
		packError = undefined;
		view = "edit";
	}
</script>

<header>
	<div class="brand">
		<h1>Signal Stickers</h1>
		{#if status}
			<span class="env" class:staging={status.env === "staging"}>Signal {status.env}</span>
		{/if}
	</div>
	{#if status}
		<nav aria-label="Sections">
			{#each views as item (item.view)}
				<button
					type="button"
					aria-current={view === item.view ? "page" : undefined}
					disabled={item.needsPack && !session.pack}
					onclick={() => (view = item.view)}
				>
					{item.label}
				</button>
			{/each}
		</nav>
	{/if}
</header>

<main>
	{#if loadError !== undefined}
		<div class="alert" role="alert">
			<p>{loadError}</p>
			<button type="button" onclick={load}>Try again</button>
		</div>
	{:else if !status}
		<p class="muted">Loading…</p>
	{:else}
		<!-- Views stay mounted while hidden, so a running link, pull, or push and its outcome survive. -->
		<div class="view" hidden={view !== "import"}>
			{#if packError !== undefined}
				<p class="alert" role="alert">{packError}</p>
			{/if}
			<ImportView {api} {progress} packTitle={session.pack?.title} onpulled={showPulled} />
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
				<Editor
					pack={session.pack}
					issues={session.issues}
					{limits}
					imageUrl={(file) => api.stickerUrl(file, session.imageVersion)}
					disabled={session.busy}
					onchange={(pack) => {
						session.edit(pack);
					}}
					onadd={(images) => {
						void session.add(images, limits);
					}}
					onremove={(file) => {
						void session.remove(file);
					}}
				/>
			</div>
			<div class="view" hidden={view !== "publish"}>
				<PublishView {api} {status} {session} {progress} onaccount={() => (view = "account")} />
			</div>
		{/if}
		<div class="view" hidden={view !== "account"}>
			<AccountView {api} {status} {progress} onstatus={(updated) => (status = updated)} />
		</div>
	{/if}
</main>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		justify-content: space-between;
		align-items: center;
		padding: 0.9rem max(1rem, calc((100vw - 1100px) / 2));
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.brand {
		display: flex;
		gap: 0.75rem;
		align-items: center;
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
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
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
		padding: 1.25rem 1rem 3rem;
	}

	main .alert p {
		margin: 0 0 0.5rem;
	}

	.view {
		display: grid;
		gap: 1rem;
	}

	.view[hidden] {
		display: none;
	}
</style>
