import { globSync, readFileSync, writeFileSync } from "node:fs";

// Every workspace package and the tray icon's crate share the repo's version.
const [version] = process.argv.slice(2);
if (version === undefined || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(version)) {
	console.error("Usage: node scripts/set-version.ts <major.minor.patch>");
	process.exit(1);
}

for (const path of ["package.json", ...globSync("packages/*/package.json")]) {
	const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (typeof manifest !== "object" || manifest === null) {
		throw new Error(`${path} is not a JSON object`);
	}
	writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, "\t")}\n`);
}
replaceVersion("packages/server/tray/Cargo.toml", /(\[package\]\n(?:.*\n)*?version = )".*"/u);
// `cargo build --locked` fails unless the lockfile names the same version.
replaceVersion(
	"packages/server/tray/Cargo.lock",
	/(name = "signal-stickers-tray"\nversion = )".*"/u,
);
console.log(`Set version ${version}`);

function replaceVersion(path: string, pattern: RegExp): void {
	const text = readFileSync(path, "utf8");
	if (!pattern.test(text)) {
		throw new Error(`${path} has no version to set`);
	}
	writeFileSync(path, text.replace(pattern, `$1"${version}"`));
}
