import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { getAssetKeys, getRawAsset } from "node:sea";

/** The executable's asset holding libsignal's native addon. */
export const ADDON_ASSET = "libsignal.node";
/** The prefix of the executable's assets that make up the web UI. */
export const WEB_ASSETS = "web/";

/** Writes the executable's web UI to a temporary folder, removed on exit, for the server to serve. */
export function unpackWebUi(): string {
	const dir = mkdtempSync(join(tmpdir(), "signal-stickers-"));
	process.once("exit", () => {
		rmSync(dir, { recursive: true, force: true });
	});
	for (const key of getAssetKeys().filter((name) => name.startsWith(WEB_ASSETS))) {
		const file = join(dir, key.slice(WEB_ASSETS.length));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, new Uint8Array(getRawAsset(key)));
	}
	return dir;
}

/** Replaces `node-gyp-build` in the executable, since Node loads an addon only from a file. */
export default function loadAddon(): unknown {
	const module = { exports: {} };
	process.dlopen(module, copyAddon(new Uint8Array(getRawAsset(ADDON_ASSET)), cacheDir()));
	return module.exports;
}

/**
 * Copies `addon` into `dir` once per version and removes older versions, unless they are loaded,
 * which Windows prevents.
 */
export function copyAddon(addon: Uint8Array, dir: string): string {
	const name = `libsignal-${createHash("sha256").update(addon).digest("hex").slice(0, 16)}.node`;
	const file = join(dir, name);
	if (existsSync(file)) {
		return file;
	}
	mkdirSync(dir, { recursive: true });
	const partial = `${file}.${process.pid}`;
	writeFileSync(partial, addon);
	renameSync(partial, file);
	for (const old of readdirSync(dir)) {
		if (old !== name && /^libsignal-[\da-f]{16}\.node$/u.test(old)) {
			try {
				rmSync(join(dir, old));
			} catch {
				// A running older version still has it loaded.
			}
		}
	}
	return file;
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
