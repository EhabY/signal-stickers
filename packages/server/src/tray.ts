import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type TrayActions = Readonly<{ open(): void; quit(): void }>;

/**
 * Shows the tray icon by running `helper` until the returned function closes it. Where the desktop
 * has no tray, the helper fails and the app goes on without it.
 */
export function showTray(
	helper: string,
	args: readonly string[],
	actions: TrayActions,
): () => void {
	const tray = spawn(helper, args, { stdio: ["pipe", "pipe", "ignore"] });
	tray.on("error", () => {});
	tray.stdin.on("error", () => {});
	createInterface({ input: tray.stdout }).on("line", (choice) => {
		if (choice === "open") {
			actions.open();
		} else if (choice === "quit") {
			actions.quit();
		}
	});
	return () => {
		tray.stdin.end();
	};
}
