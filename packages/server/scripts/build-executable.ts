// Builds the editor into this platform's app in dist/executable and smoke-tests it; with --archive,
// also packs it into dist/release. Needs Node.js 26 and the built web UI (`pnpm build`).
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import * as esbuild from "esbuild";

import manifest from "../package.json" with { type: "json" };
import { ADDON_ASSET, WEB_ASSETS } from "../src/executableAssets.ts";
import { brandWindowsExecutable } from "./brand-windows-executable.ts";
import { smokeTest } from "./smoke-test.ts";

const NAME = "Signal Stickers";
const BUILD_DIR = "dist/executable";
const RELEASE_DIR = "dist/release";
const WEB_DIR = "../web/dist";
const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
	win32: "windows",
	darwin: "macos",
};
const { platform, arch } = process;

if (Number(process.versions.node.split(".")[0]) < 26) {
	throw new Error("Building the executable needs Node.js 26 or later");
}
const { values } = parseArgs({ options: { archive: { type: "boolean", default: false } } });

const folder = join(BUILD_DIR, `signal-stickers-${PLATFORM_NAMES[platform] ?? platform}-${arch}`);
await rm(BUILD_DIR, { recursive: true, force: true });
await rm(RELEASE_DIR, { recursive: true, force: true });
await mkdir(folder, { recursive: true });
const executable = await buildApp(folder);
await smokeTest(executable, NAME);
if (values.archive) {
	await archive(folder);
}

/** Resolves the path of the app's executable. */
async function buildApp(target: string): Promise<string> {
	const sea = {
		main: await bundle(join(BUILD_DIR, "main.mjs")),
		executable: await prepareNode(join(BUILD_DIR, platform === "win32" ? "node.exe" : "node")),
	};
	if (platform !== "darwin") {
		const output = join(target, platform === "win32" ? "signal-stickers.exe" : "signal-stickers");
		await buildSea({ ...sea, output });
		return output;
	}
	const app = join(target, `${NAME}.app`);
	await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
	await mkdir(join(app, "Contents", "Resources"));
	await copyFile("assets/icon.icns", join(app, "Contents", "Resources", "icon.icns"));
	await writeFile(join(app, "Contents", "Info.plist"), infoPlist());
	const output = join(app, "Contents", "MacOS", "signal-stickers");
	await buildSea({ ...sea, output });
	// Apple Silicon runs only signed code, and an ad-hoc signature needs no certificate.
	execFileSync("codesign", ["--sign", "-", "--force", app]);
	return output;
}

async function bundle(outfile: string): Promise<string> {
	await esbuild.build({
		entryPoints: ["src/main.ts"],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node26",
		alias: { "node-gyp-build": "./src/executableAssets.ts" },
		// Optional speedups for ws, which falls back without them.
		external: ["bufferutil", "utf-8-validate"],
		// Bundled CommonJS dependencies (ws) require Node built-ins, which an ES module lacks.
		banner: {
			js: [
				'import { createRequire } from "node:module";',
				"const require = createRequire(import.meta.url);",
			].join("\n"),
		},
		// Only `pnpm start` from source should resolve paths against INIT_CWD; see src/main.ts.
		define: { "process.env.INIT_CWD": "undefined" },
		logLevel: "warning",
	});
	return outfile;
}

/**
 * Copies Node to build the app on: on Windows with the app's icon, name, and no console window,
 * elsewhere without debugging symbols, a quarter of its size on Linux. On macOS, `-x` keeps the
 * functions that addons call.
 */
async function prepareNode(target: string): Promise<string> {
	if (platform === "win32") {
		const node = await readFile(process.execPath);
		const icon = await readFile("assets/icon.ico");
		await writeFile(
			target,
			brandWindowsExecutable(node, { icon, name: NAME, version: manifest.version }),
		);
	} else {
		await copyFile(process.execPath, target);
		execFileSync("strip", platform === "darwin" ? ["-x", target] : [target]);
	}
	return target;
}

type SeaOptions = Readonly<{ main: string; executable: string; output: string }>;

async function buildSea(options: SeaOptions): Promise<void> {
	const config = join(BUILD_DIR, "sea-config.json");
	await writeFile(
		config,
		JSON.stringify({
			...options,
			mainFormat: "module",
			assets: await assets(),
			disableExperimentalSEAWarning: true,
		}),
	);
	execFileSync(process.execPath, ["--build-sea", config]);
}

/** This platform's libsignal addon and the web UI, keyed by their names in the executable. */
async function assets(): Promise<Record<string, string>> {
	const libsignal = dirname(
		createRequire(import.meta.resolve("@signal-stickers/core")).resolve(
			"@signalapp/libsignal-client/package.json",
		),
	);
	const prebuild = join(libsignal, "prebuilds", `${platform}-${arch}`);
	const files: Record<string, string> = {
		[ADDON_ASSET]: join(prebuild, "@signalapp+libsignal-client.node"),
	};
	for (const entry of await readdir(WEB_DIR, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			const file = join(entry.parentPath, entry.name);
			files[WEB_ASSETS + relative(WEB_DIR, file).split(sep).join("/")] = file;
		}
	}
	return files;
}

/** The app shows no Dock icon, having no window of its own. */
function infoPlist(): string {
	const strings = {
		CFBundleName: NAME,
		CFBundleDisplayName: NAME,
		CFBundleIdentifier: "io.github.ehaby.signal-stickers",
		CFBundleExecutable: "signal-stickers",
		CFBundleIconFile: "icon",
		CFBundlePackageType: "APPL",
		CFBundleShortVersionString: manifest.version,
		CFBundleVersion: manifest.version,
	};
	const entries = Object.entries(strings).map(
		([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`,
	);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		...entries,
		"\t<key>LSUIElement</key>\n\t<true/>",
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

/** Packs the app and its licenses with LZMA, a third smaller than zip; Windows 11 opens `.7z`. */
async function archive(target: string): Promise<void> {
	const name = basename(target);
	const output = resolve(RELEASE_DIR, name);
	await copyFile("../../LICENSE", join(target, "LICENSE.txt"));
	await writeFile(join(target, "LICENSE-node.txt"), await nodeLicense());
	await mkdir(RELEASE_DIR, { recursive: true });
	if (platform === "win32") {
		execFileSync("7z", ["a", "-t7z", "-mx=9", `${output}.7z`, name], { cwd: BUILD_DIR });
	} else if (platform === "darwin") {
		await symlink("/Applications", join(target, "Applications"));
		const image = ["-volname", NAME, "-srcfolder", target, "-format", "ULMO"];
		execFileSync("hdiutil", ["create", "-quiet", ...image, `${output}.dmg`]);
	} else {
		execFileSync("tar", ["-cJf", `${output}.tar.xz`, name], {
			cwd: BUILD_DIR,
			env: { ...process.env, XZ_OPT: "-9" },
		});
	}
}

async function nodeLicense(): Promise<string> {
	const url = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Could not download Node's license from ${url}: ${response.status}`);
	}
	return response.text();
}
