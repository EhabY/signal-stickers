<script lang="ts">
	import type { StatusResponse } from "@signal-stickers/server/api";

	import { errorMessage, type Api } from "../lib/api.ts";
	import type { LiveProgress } from "../lib/events.svelte.ts";
	import QrCode from "./QrCode.svelte";

	type Props = {
		api: Api;
		status: StatusResponse;
		progress: LiveProgress;
		onstatus: (status: StatusResponse) => void;
	};

	let { api, status, progress, onstatus }: Props = $props();
	const link = $derived(status.link);
	let linking: AbortController | undefined = $state.raw();
	let confirmingUnlink = $state(false);
	let unlinking = $state(false);
	let error: string | undefined = $state();

	async function startLinking(): Promise<void> {
		const controller = new AbortController();
		linking = controller;
		progress.link = undefined;
		error = undefined;
		try {
			onstatus(await api.link(controller.signal));
		} catch (caught) {
			if (!controller.signal.aborted) {
				error = errorMessage(caught);
			}
		} finally {
			linking = undefined;
		}
	}

	async function unlink(): Promise<void> {
		unlinking = true;
		error = undefined;
		try {
			onstatus(await api.unlink());
			confirmingUnlink = false;
		} catch (caught) {
			error = errorMessage(caught);
		} finally {
			unlinking = false;
		}
	}
</script>

<section class="panel" aria-labelledby="account-heading">
	<h2 id="account-heading">Account</h2>
	<p class="intro">
		Link your Signal account to publish packs. Importing and editing work without linking.
	</p>

	{#if link.linked}
		<dl>
			<dt>Status</dt>
			<dd>Linked to Signal {link.env}</dd>
			{#if link.number !== undefined}
				<dt>Phone number</dt>
				<dd>{link.number}</dd>
			{/if}
			<dt>Device</dt>
			<dd>signal-stickers (device {link.deviceId})</dd>
			<dt>Linked on</dt>
			<dd>{new Date(link.createdAt).toLocaleString()}</dd>
		</dl>
		<p class="muted">
			This computer keeps the device's credentials. Anyone who gets them can act as this device, so
			keep them private.
		</p>
		{#if link.env !== status.env}
			<p class="warning">
				This device is linked to Signal {link.env}, but the server is using Signal {status.env}.
				Restart the server for {link.env} to publish.
			</p>
		{/if}
		{#if confirmingUnlink}
			<p>
				Remove this device from your Signal account? Its credentials are deleted from this computer.
			</p>
			<div class="actions">
				<button type="button" class="danger" disabled={unlinking} onclick={unlink}>
					{unlinking ? "Unlinking…" : "Unlink"}
				</button>
				<button type="button" disabled={unlinking} onclick={() => (confirmingUnlink = false)}>
					Cancel
				</button>
			</div>
		{:else}
			<button type="button" onclick={() => (confirmingUnlink = true)}>Unlink this device</button>
		{/if}
	{:else if linking}
		<div class="linking" aria-live="polite">
			{#if progress.link?.step === "waitingForScan"}
				<QrCode text={progress.link.qrUrl} label="QR code to link this device" />
				<ol>
					<li>Open Signal on your phone.</li>
					<li>Go to <strong>Settings</strong>, then <strong>Linked devices</strong>.</li>
					<li>Tap <strong>Link a new device</strong> and scan this code.</li>
				</ol>
			{:else if progress.link?.step === "registering"}
				<p>Scanned. Registering this device…</p>
			{:else}
				<p>Connecting to Signal {status.env}…</p>
			{/if}
		</div>
		<button type="button" onclick={() => linking?.abort()}>Cancel</button>
	{:else}
		<p>
			Publishing needs this tool linked to your Signal account as its own device, named
			<strong>signal-stickers</strong>. It appears in your phone's linked devices, where you can
			remove it at any time, and its credentials stay on this computer.
		</p>
		<button type="button" class="primary" onclick={startLinking}>
			Link to Signal {status.env}
		</button>
	{/if}

	{#if error !== undefined}
		<p class="alert" role="alert">{error}</p>
	{/if}
</section>

<style>
	section {
		max-width: 48rem;
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
	}

	dt {
		color: var(--text-muted);
	}

	dd {
		margin: 0;
		min-width: 0;
	}

	.linking {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		align-items: center;
	}

	.linking ol {
		margin: 0;
		padding-left: 1.2rem;
	}

	@media (max-width: 420px) {
		dl {
			grid-template-columns: 1fr;
		}

		dd {
			margin-bottom: 0.75rem;
		}
	}
</style>
