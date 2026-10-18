import type { ValidationIssue } from "./api.ts";

/** The issues that stop a publish. */
export function errorsIn(issues: readonly ValidationIssue[]): ValidationIssue[] {
	return issues.filter(({ severity }) => severity === "error");
}

/** The issues Signal accepts but treats differently, such as stickers without an emoji. */
export function warningsIn(issues: readonly ValidationIssue[]): ValidationIssue[] {
	return issues.filter(({ severity }) => severity === "warning");
}

/** A line per warning, with the stickers without an emoji counted in one. */
export function describeWarnings(warnings: readonly ValidationIssue[]): string[] {
	const others = warnings
		.filter(({ code }) => code !== "missingEmoji")
		.map(({ message }) => message);
	const missingEmoji = warnings.length - others.length;
	if (missingEmoji === 0) {
		return others;
	}
	const stickers =
		missingEmoji === 1
			? "1 sticker has no emoji, so Signal won't suggest it"
			: `${missingEmoji} stickers have no emoji, so Signal won't suggest them`;
	return [`${stickers} while typing.`, ...others];
}
