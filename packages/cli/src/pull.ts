import { resolve } from "node:path";

import { parsePackLink, pullPack, type Environment, type Pack } from "@signal-stickers/core";

import { defaultCdn, progressLine, UsageError, type CliContext } from "./context.ts";

export async function pull(
	[link, dir = "pack", ...extra]: readonly string[],
	env: Environment,
	{ stdout, stderr, cwd, signal, createCdn = defaultCdn }: CliContext,
): Promise<void> {
	if (link === undefined || extra.length > 0) {
		throw new UsageError("Usage: pull <link> [dir]");
	}
	const locator = parsePackLink(link);
	const target = resolve(cwd, dir);
	stderr.write(`Pulling from Signal ${env} into ${target}\n`);
	const progress = progressLine(stderr, "Downloaded");
	const pack = await pullPack({
		locator,
		dir: target,
		cdn: createCdn(env),
		signal,
		onProgress: progress.update,
	}).finally(progress.end);
	stdout.write(`${summarize(pack)} into ${target}\n`);
}

function summarize({ title, author, stickers }: Pack): string {
	const name = title === "" ? "an untitled pack" : `"${title}"`;
	const by = author === "" ? "" : ` by ${author}`;
	const count = `${stickers.length} ${stickers.length === 1 ? "sticker" : "stickers"}`;
	return `Pulled ${name}${by}: ${count}`;
}
