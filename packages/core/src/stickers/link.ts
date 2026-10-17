export class InvalidPackLinkError extends Error {
	override name = "InvalidPackLinkError";
}

/** A pack's 32-hex-char id and 64-hex-char key. */
export type PackLocator = Readonly<{ packId: string; packKey: string }>;

const PACK_ID = /^[0-9a-f]{32}$/iu;
const PACK_KEY = /^[0-9a-f]{64}$/iu;

/**
 * Parses `https://signal.art/addstickers/#pack_id=…&pack_key=…` or
 * `sgnl://addstickers?pack_id=…&pack_key=…`.
 */
export function parsePackLink(link: string): PackLocator {
	const params = linkParams(link.trim());
	if (!params) {
		throw new InvalidPackLinkError("Not a Signal sticker pack link");
	}
	const packId = params.get("pack_id");
	const packKey = params.get("pack_key");
	if (!isPackIdValid(packId)) {
		throw new InvalidPackLinkError("Sticker pack link has an invalid pack_id");
	}
	if (packKey === null || !PACK_KEY.test(packKey)) {
		throw new InvalidPackLinkError("Sticker pack link has an invalid pack_key");
	}
	return { packId, packKey };
}

export function buildPackLink({ packId, packKey }: PackLocator): string {
	return `https://signal.art/addstickers/#pack_id=${packId}&pack_key=${packKey}`;
}

export function isPackIdValid(packId: unknown): packId is string {
	return typeof packId === "string" && PACK_ID.test(packId);
}

/** Matches Signal's redaction so pack ids never appear in full in logs. */
export function redactPackId(packId: string): string {
	return `[REDACTED]${packId.slice(-3)}`;
}

function linkParams(link: string): URLSearchParams | undefined {
	if (!URL.canParse(link)) {
		return undefined;
	}
	const url = new URL(link);
	if (
		url.protocol === "https:" &&
		url.host === "signal.art" &&
		/^\/addstickers\/?$/u.test(url.pathname)
	) {
		return new URLSearchParams(url.hash.slice(1));
	}
	if (url.protocol === "sgnl:" && url.host === "addstickers" && /^\/?$/u.test(url.pathname)) {
		return url.searchParams;
	}
	return undefined;
}
