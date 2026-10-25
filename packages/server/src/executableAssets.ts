import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { getAssetKeys, getRawAsset } from "node:sea";

import { renameWithRetries } from "@signal-stickers/core";

export const ADDON_ASSET = "libsignal";
export const TRAY_ASSET = "tray";
/** The prefix of the web UI's assets. */
export const WEB_ASSETS = "web/";

export type UnpackedAssets = Readonly<{ webDir: string; tray: string }>;

let addon: string | undefined;

/**
 * Writes the web UI to a temporary folder, removed on exit, and copies the addon and tray icon to
 * the user's cache, since Node serves, loads, and runs only real files.
 */
export async function unpackAssets(): Promise<UnpackedAssets> {
	const cache = cacheDir();
	const tray = process.platform === "win32" ? "signal-stickers-tray.exe" : "signal-stickers-tray";
	addon = await copyToCache(asset(ADDON_ASSET), join(cache, ADDON_ASSET), "libsignal.node");
	return {
		webDir: await unpackWebUi(),
		tray: await copyToCache(asset(TRAY_ASSET), join(cache, TRAY_ASSET), tray),
	};
}

/** Replaces `node-gyp-build` in the executable, loading the addon {@link unpackAssets} copied. */
export default function loadAddon(): unknown {
	if (addon === undefined) {
		throw new Error("The executable's assets are not unpacked");
	}
	const module = { exports: {} };
	process.dlopen(module, addon);
	return module.exports;
}

/**
 * Copies `data` to `dir/<hash>/name` once per version, and removes older versions unless running,
 * which Windows prevents.
 */
export async function copyToCache(data: Uint8Array, dir: string, name: string): Promise<string> {
	const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
	const file = join(dir, hash, name);
	if (await exists(file)) {
		return file;
	}
	await mkdir(dir, { recursive: true });
	const partial = await mkdtemp(join(dir, `${hash}.partial-`));
	await writeFile(join(partial, name), data, { mode: 0o755 });
	try {
		await renameWithRetries(partial, join(dir, hash));
	} catch (error) {
		await rm(partial, { recursive: true, force: true });
		// Another launch may have copied the same version first.
		if (!(await exists(file))) {
			throw error;
		}
	}
	const older = (await readdir(dir)).filter(
		(entry) => entry !== hash && /^[\da-f]{16}$/u.test(entry),
	);
	// A version still running cannot be removed.
	await Promise.allSettled(
		older.map((entry) => rm(join(dir, entry), { recursive: true, maxRetries: 3 })),
	);
	return file;
}

function asset(key: string): Uint8Array {
	return new Uint8Array(getRawAsset(key));
}

async function unpackWebUi(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "signal-stickers-"));
	process.once("exit", () => {
		rmSync(dir, { recursive: true, force: true });
	});
	const keys = getAssetKeys().filter((key) => key.startsWith(WEB_ASSETS));
	await Promise.all(
		keys.map(async (key) => {
			const file = join(dir, key.slice(WEB_ASSETS.length));
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, asset(key));
		}),
	);
	return dir;
}

function exists(file: string): Promise<boolean> {
	return access(file).then(
		() => true,
		() => false,
	);
}

function cacheDir(): string {
	const { env, platform } = process;
	if (platform === "win32") {
		return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "signal-stickers");
	}
	if (platform === "darwin") {
		return join(homedir(), "Library", "Caches", "signal-stickers");
	}
	const xdg = env.XDG_CACHE_HOME;
	return join(
		xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".cache"),
		"signal-stickers",
	);
}
