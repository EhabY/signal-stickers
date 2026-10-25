// Builds this platform's app into dist/executable, and with --archive packs it into dist/release.
// Needs Node.js 26, Rust, and the built web UI (`pnpm build`).
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import * as esbuild from "esbuild";

import manifest from "../package.json" with { type: "json" };
import { ADDON_ASSET, TRAY_ASSET, WEB_ASSETS } from "../src/executableAssets.ts";
import { brandWindowsExecutable } from "./brand-windows-executable.ts";

const NAME = "Signal Stickers";
const OUT_DIR = "dist/executable";
const RELEASE_DIR = "dist/release";
const PLATFORMS: Partial<Record<NodeJS.Platform, string>> = { win32: "windows", darwin: "macos" };
const { platform, arch } = process;
const exe = platform === "win32" ? ".exe" : "";
const { values } = parseArgs({ options: { archive: { type: "boolean", default: false } } });

const folder = join(OUT_DIR, `signal-stickers-${PLATFORMS[platform] ?? platform}-${arch}`);
const app = join(folder, `${NAME}.app`);
const executable =
	platform === "darwin"
		? join(app, "Contents", "MacOS", "signal-stickers")
		: join(folder, `signal-stickers${exe}`);
await rm(OUT_DIR, { recursive: true, force: true });
await rm(RELEASE_DIR, { recursive: true, force: true });
await mkdir(dirname(executable), { recursive: true });

await esbuild.build({
	entryPoints: ["src/main.ts"],
	outfile: join(OUT_DIR, "main.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node26",
	alias: { "node-gyp-build": "./src/executableAssets.ts" },
	// Optional ws speedups.
	external: ["bufferutil", "utf-8-validate"],
	// Bundled CommonJS (ws) needs `require`.
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	// Only `pnpm start` resolves paths against INIT_CWD; see src/main.ts.
	define: { "process.env.INIT_CWD": "undefined" },
	logLevel: "warning",
});
execFileSync("cargo", ["build", "--release", "--locked"], { cwd: "tray", stdio: "inherit" });

// The app runs on a copy of Node: on Windows with its icon and no console window, elsewhere
// without debugging symbols, a quarter of its size. macOS addons need the symbols `-x` keeps.
const node = join(OUT_DIR, `node${exe}`);
if (platform === "win32") {
	const icon = await readFile("assets/icon.ico");
	const branded = brandWindowsExecutable(await readFile(process.execPath), {
		icon,
		name: NAME,
		version: manifest.version,
	});
	await writeFile(node, branded);
} else {
	await copyFile(process.execPath, node);
	execFileSync("strip", platform === "darwin" ? ["-x", node] : [node]);
}

const libsignal = dirname(
	createRequire(import.meta.resolve("@signal-stickers/core")).resolve(
		"@signalapp/libsignal-client/package.json",
	),
);
const assets: Record<string, string> = {
	[ADDON_ASSET]: join(
		libsignal,
		"prebuilds",
		`${platform}-${arch}`,
		"@signalapp+libsignal-client.node",
	),
	[TRAY_ASSET]: join("tray", "target", "release", `signal-stickers-tray${exe}`),
};
for (const entry of await readdir("../web/dist", { recursive: true, withFileTypes: true })) {
	if (entry.isFile()) {
		const file = join(entry.parentPath, entry.name);
		assets[WEB_ASSETS + relative("../web/dist", file).split(sep).join("/")] = file;
	}
}
const config = join(OUT_DIR, "sea-config.json");
await writeFile(
	config,
	JSON.stringify({
		main: join(OUT_DIR, "main.mjs"),
		mainFormat: "module",
		executable: node,
		output: executable,
		assets,
		disableExperimentalSEAWarning: true,
	}),
);
execFileSync(process.execPath, ["--build-sea", config]);

if (platform === "darwin") {
	await mkdir(join(app, "Contents", "Resources"));
	await copyFile("assets/icon.icns", join(app, "Contents", "Resources", "icon.icns"));
	// LSUIElement: no Dock icon, since the tray shows the app.
	await writeFile(
		join(app, "Contents", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>CFBundleName</key><string>${NAME}</string>
	<key>CFBundleIdentifier</key><string>io.github.ehaby.signal-stickers</string>
	<key>CFBundleExecutable</key><string>signal-stickers</string>
	<key>CFBundleIconFile</key><string>icon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${manifest.version}</string>
	<key>CFBundleVersion</key><string>${manifest.version}</string>
	<key>LSUIElement</key><true/>
</dict></plist>
`,
	);
	// Apple Silicon runs only signed code; an ad-hoc signature needs no certificate.
	execFileSync("codesign", ["--sign", "-", "--force", app]);
}
// Checks that the app starts.
execFileSync(executable, ["--help"], { stdio: "ignore" });

if (values.archive) {
	const name = basename(folder);
	const archive = resolve(RELEASE_DIR, name);
	const nodeLicense = await fetch(
		`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
	);
	if (!nodeLicense.ok) {
		throw new Error(`Could not download Node's license: ${nodeLicense.status}`);
	}
	await writeFile(join(folder, "LICENSE-node.txt"), await nodeLicense.text());
	await copyFile("../../LICENSE", join(folder, "LICENSE.txt"));
	await mkdir(RELEASE_DIR);
	// LZMA everywhere, a third smaller than zip; Windows 11 opens .7z.
	if (platform === "win32") {
		execFileSync("7z", ["a", "-t7z", "-mx=9", `${archive}.7z`, name], { cwd: OUT_DIR });
	} else if (platform === "darwin") {
		const files = await readdir(folder, { recursive: true, withFileTypes: true });
		const sizes = await Promise.all(
			files
				.filter((file) => file.isFile())
				.map(async (file) => (await stat(join(file.parentPath, file.name))).size),
		);
		const megabytes = Math.ceil((sizes.reduce((sum, size) => sum + size, 0) * 1.2) / 2 ** 20);
		await symlink("/Applications", join(folder, "Applications"));
		execFileSync("hdiutil", [
			"create",
			"-size",
			`${megabytes}m`,
			"-volname",
			NAME,
			"-srcfolder",
			folder,
			"-format",
			"ULMO",
			`${archive}.dmg`,
		]);
	} else {
		execFileSync("tar", ["-cJf", `${archive}.tar.xz`, name], {
			cwd: OUT_DIR,
			env: { ...process.env, XZ_OPT: "-9" },
		});
	}
}
