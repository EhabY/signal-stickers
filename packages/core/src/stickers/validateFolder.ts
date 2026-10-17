import { NotImplementedError } from "../util/notImplemented.ts";
import type { ValidationIssue } from "./validate.ts";

/**
 * Reads `pack.json` and the images it names from `dir` and validates them with `validatePack`.
 * Throws `PackFormatError` when `pack.json` itself is malformed.
 */
export function validatePackFolder(_dir: string): Promise<ValidationIssue[]> {
	return Promise.reject(new NotImplementedError("validatePackFolder"));
}
