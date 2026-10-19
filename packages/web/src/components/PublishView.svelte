<script lang="ts">
	import type { StatusResponse } from "@signal-stickers/server/api";

	import { ApiError, errorMessage, type Pack, type ValidationIssue } from "../lib/api.ts";
	import type { LiveProgress } from "../lib/events.svelte.ts";
	import { errorsIn, warningsIn } from "../lib/issues.ts";
	import type { PackSession } from "../lib/packSession.svelte.ts";
	import IssueList from "./IssueList.svelte";
	import ProgressBar from "./ProgressBar.svelte";
	import QrCode from "./QrCode.svelte";
	import WarningNotes from "./WarningNotes.svelte";

	type Props = {
		status: StatusResponse;
		session: PackSession;
		progress: LiveProgress;
		onaccount: () => void;
	};

	let { status, session, progress, onaccount }: Props = $props();
	let publishing = $state(false);
	let published: string | undefined = $state();
	/** The pack as published, so it is not published again until it changes. */
	let publishedPack: Pack | undefined = $state.raw();
	let copied = $state(false);
	let error: string | undefined = $state();
	let refusedIssues: readonly ValidationIssue[] = $state.raw([]);
	const link = $derived(status.link);
	const errors = $derived(errorsIn(session.issues));
	const warnings = $derived(warningsIn(session.issues));
	const unchanged = $derived(published !== undefined && session.pack === publishedPack);
	const ready = $derived(
		link.linked &&
			link.env === status.env &&
			errors.length === 0 &&
			!session.pending &&
			!session.locked &&
			!unchanged,
	);

	async function publish(): Promise<void> {
		publishing = true;
		published = undefined;
		copied = false;
		error = undefined;
		refusedIssues = [];
		progress.push = undefined;
		const pack = session.pack;
		try {
			published = (await session.publish()).link;
			publishedPack = pack;
		} catch (caught) {
			error = errorMessage(caught);
			refusedIssues = caught instanceof ApiError ? caught.issues : [];
		} finally {
			publishing = false;
		}
	}

	async function copyLink(): Promise<void> {
		if (published === undefined) {
			return;
		}
		try {
			await navigator.clipboard.writeText(published);
			copied = true;
		} catch (caught) {
			error = `Could not copy the link: ${errorMessage(caught)}`;
		}
	}
</script>

<section class="panel" aria-labelledby="publish-heading">
	<h2 id="publish-heading">Publish</h2>
	<p class="intro">
		Uploads <strong>{session.pack?.title || "this pack"}</strong> to Signal {status.env} as a new pack
		with its own link. Anyone with the link can install it; the original pack is unchanged.
	</p>

	{#if !link.linked}
		<p class="warning">Link this tool to your Signal account before publishing.</p>
		<button type="button" onclick={onaccount}>Go to Account</button>
	{:else if link.env !== status.env}
		<p class="warning">
			This device is linked to Signal {link.env}, but the server is using Signal {status.env}.
		</p>
	{/if}

	{#if errors.length > 0}
		<div>
			<p>Fix these in the editor first:</p>
			<IssueList issues={errors} />
		</div>
	{/if}
	<WarningNotes {warnings} />

	{#if session.pending}
		<p class="muted">Your images are still being prepared. You can publish when they’re ready.</p>
	{/if}

	<button type="button" class="primary" disabled={!ready || publishing} onclick={publish}>
		{publishing ? "Publishing…" : `Publish to Signal ${status.env}`}
	</button>

	{#if publishing && progress.push}
		<ProgressBar done={progress.push.done} total={progress.push.total} label="Uploaded" />
	{/if}

	{#if error !== undefined}
		<div class="alert" role="alert">
			<p>{error}</p>
			{#if refusedIssues.length > 0}
				<IssueList issues={refusedIssues} />
			{/if}
		</div>
	{/if}

	{#if published !== undefined}
		<div class="published" aria-live="polite">
			<h3>Published</h3>
			<p>Share this link, or scan the code with a phone that has Signal.</p>
			{#if unchanged}
				<p class="muted">This version is published. Make a change to publish a new version.</p>
			{/if}
			<div class="link">
				<a href={published} target="_blank" rel="noreferrer">{published}</a>
				<button type="button" onclick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
			</div>
			<QrCode text={published} label="QR code for the new pack link" />
		</div>
	{/if}
</section>

<style>
	section {
		width: 100%;
		max-width: 48rem;
		margin-inline: auto;
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}

	section > :global(*) {
		max-width: 100%;
	}

	.alert p {
		margin: 0;
	}

	.published {
		display: grid;
		gap: 0.6rem;
		width: 100%;
		margin-top: 0.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.published h3 {
		margin: 0;
		color: var(--success);
	}

	.link {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.link a {
		word-break: break-all;
	}
</style>
