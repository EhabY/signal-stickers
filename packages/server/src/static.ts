import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

/** Serves the file at URL `path` from `root`, `index.html` for `/`, and 404 for anything else. */
export async function serveStatic(root: string, path: string, res: ServerResponse): Promise<void> {
	const file = resolveInside(root, path === "/" ? "/index.html" : path);
	if (file === undefined) {
		sendNotFound(res);
		return;
	}
	try {
		const data = await readFile(file);
		res
			.writeHead(200, {
				"Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			})
			.end(data);
	} catch {
		sendNotFound(res);
	}
}

function resolveInside(root: string, path: string): string | undefined {
	const decoded = decodePath(path);
	if (decoded === undefined) {
		return undefined;
	}
	const file = resolve(root, `.${decoded}`);
	const inside = relative(root, file);
	return inside === "" || inside.split(sep)[0] === ".." || isAbsolute(inside) ? undefined : file;
}

function decodePath(path: string): string | undefined {
	try {
		return decodeURIComponent(path);
	} catch {
		return undefined;
	}
}

function sendNotFound(res: ServerResponse): void {
	res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
}
