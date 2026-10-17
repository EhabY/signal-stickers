import { globSync, readFileSync, writeFileSync } from "node:fs";

// Every workspace package shares the repo's version.
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
console.log(`Set version ${version}`);
