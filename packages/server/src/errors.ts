import {
	HttpError,
	InvalidPackLinkError,
	PackFormatError,
	PackValidationError,
} from "@signal-stickers/core";

import type { ErrorResponse } from "./api.ts";

/** A failure with the HTTP status to answer it with. Its message is shown to the user. */
export class ApiError extends Error {
	override name = "ApiError";
	readonly status: number;

	constructor(status: number, message: string, options?: ErrorOptions) {
		super(message, options);
		this.status = status;
	}
}

/** Maps a failed request to its status and body. Core error messages never carry secrets. */
export function toErrorResponse(error: unknown): { status: number; body: ErrorResponse } {
	if (error instanceof ApiError) {
		return { status: error.status, body: { error: error.message } };
	}
	if (error instanceof PackValidationError) {
		return {
			status: 400,
			body: { error: "The pack is not ready to upload", issues: error.issues },
		};
	}
	if (error instanceof PackFormatError || error instanceof InvalidPackLinkError) {
		return { status: 400, body: { error: error.message } };
	}
	if (error instanceof HttpError) {
		return { status: 502, body: { error: error.message } };
	}
	return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
}
