import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Starts the app and checks that it serves the editor, titled `title`. */
export async function smokeTest(app: string, title: string): Promise<void> {
	const home = await mkdtemp(join(tmpdir(), "signal-stickers-smoke-"));
	const server = spawn(app, ["--no-open"], {
		env: { ...process.env, ...Object.fromEntries(USER_FOLDERS.map((name) => [name, home])) },
		stdio: ["ignore", "pipe", "inherit"],
	});
	try {
		for await (const url of createInterface({ input: server.stdout })) {
			await expectPage(`${url}/api/status`, '"env":"production"');
			await expectPage(`${url}/`, `<title>${title}</title>`);
			return;
		}
		throw new Error("The app stopped without serving the editor");
	} finally {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill();
			await once(server, "exit");
		}
		await rm(home, { recursive: true, force: true });
	}
}

/** Folders the app would otherwise use from the user's own. */
const USER_FOLDERS = [
	"HOME",
	"APPDATA",
	"LOCALAPPDATA",
	"TEMP",
	"TMP",
	"TMPDIR",
	"XDG_CONFIG_HOME",
];

async function expectPage(url: string, text: string): Promise<void> {
	const page = await (await fetch(url)).text();
	if (!page.includes(text)) {
		throw new Error(`${url} lacks ${text}`);
	}
}
