import { execFile } from "node:child_process";

/** Opens `url` in the default browser and resolves whether that worked. */
export function openBrowser(url: string): Promise<boolean> {
	const [command, args] = browserCommand(process.platform, url);
	return new Promise((resolve) => {
		execFile(command, args, { windowsHide: true }, (error) => {
			resolve(error === null);
		});
	});
}

export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
	if (platform === "win32") {
		// `start` takes its first quoted argument as a window title; Node passes "" for the empty one.
		return ["cmd", ["/c", "start", "", url]];
	}
	return [platform === "darwin" ? "open" : "xdg-open", [url]];
}
