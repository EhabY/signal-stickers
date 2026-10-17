import type { ApiRoute } from "./api.ts";
import { ApiError } from "./errors.ts";
import type { ApiHandlers, RouteRequest } from "./routes.ts";

export type Handler = ApiHandlers[ApiRoute];

export type RouteMatch = Readonly<{ handle: Handler; params: Record<string, string> }>;

/** Finds the handler for a request, throwing a 404 {@link ApiError} when there is none. */
export type Router = (method: string, path: string) => RouteMatch;

type Route = Readonly<{ method: string; segments: readonly string[]; handle: Handler }>;

/** Matches requests to the `"METHOD /path/:param"` keys of `handlers`. */
export function createRouter(handlers: ApiHandlers): Router {
	const routes: Route[] = Object.entries(handlers).map(([key, handle]) => {
		const [method = "", path = ""] = key.split(" ");
		return { method, segments: path.split("/"), handle };
	});
	return (method, path) => {
		const segments = path.split("/");
		for (const route of routes) {
			const params = route.method === method ? matchSegments(route.segments, segments) : undefined;
			if (params) {
				return { handle: route.handle, params };
			}
		}
		throw new ApiError(404, "Not found");
	};
}

/** A `:name` segment of the matched route, which the router only matches when the path has it. */
export function routeParam({ params }: RouteRequest, name: string): string {
	const value = params[name];
	if (value === undefined) {
		throw new Error(`The route has no :${name} parameter`);
	}
	return value;
}

/** Like {@link routeParam}, answering 400 unless the segment is a whole number. */
export function wholeNumberParam(request: RouteRequest, name: string): number {
	const value = routeParam(request, name);
	if (!/^\d+$/u.test(value)) {
		throw new ApiError(400, `${name} must be a whole number, not ${value}`);
	}
	return Number(value);
}

function matchSegments(
	pattern: readonly string[],
	segments: readonly string[],
): Record<string, string> | undefined {
	if (pattern.length !== segments.length) {
		return undefined;
	}
	const params: Record<string, string> = {};
	for (const [index, part] of pattern.entries()) {
		const segment = segments[index] ?? "";
		if (part.startsWith(":")) {
			params[part.slice(1)] = decodeSegment(segment);
		} else if (part !== segment) {
			return undefined;
		}
	}
	return params;
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch (error) {
		throw new ApiError(400, "Malformed URL", { cause: error });
	}
}
