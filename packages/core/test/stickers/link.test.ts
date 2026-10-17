import { describe, expect, it } from "vitest";

import {
	buildPackLink,
	InvalidPackLinkError,
	parsePackLink,
	redactPackId,
} from "../../src/stickers/link.ts";
import { PACK_ID, PACK_KEY } from "../support/index.ts";

const PARAMS = `pack_id=${PACK_ID}&pack_key=${PACK_KEY}`;

describe("pack links", () => {
	it.each([
		`https://signal.art/addstickers/#${PARAMS}`,
		`https://signal.art/addstickers#${PARAMS}`,
		`sgnl://addstickers?${PARAMS}`,
		`sgnl://addstickers/?${PARAMS}`,
		`  https://signal.art/addstickers/#${PARAMS}\n`,
		`https://signal.art/addstickers/#pack_key=${PACK_KEY}&pack_id=${PACK_ID}`,
	])("parses %s", (link) => {
		expect(parsePackLink(link)).toEqual({ packId: PACK_ID, packKey: PACK_KEY });
	});

	it.each([
		"not a link",
		`https://example.com/addstickers/#${PARAMS}`,
		`http://signal.art/addstickers/#${PARAMS}`,
		`https://signal.art:8443/addstickers/#${PARAMS}`,
		`https://signal.art/other/#${PARAMS}`,
		`https://signal.art/addstickers/?${PARAMS}`,
		`sgnl://other?${PARAMS}`,
		`https://signal.art/addstickers/#pack_id=${PACK_ID}`,
		`https://signal.art/addstickers/#pack_id=abc&pack_key=${PACK_KEY}`,
		`https://signal.art/addstickers/#pack_id=${PACK_ID}&pack_key=abc123`,
		`https://signal.art/addstickers/#pack_id=${PACK_ID}&pack_key=${"zz".repeat(32)}`,
	])("rejects %s", (link) => {
		expect(() => parsePackLink(link)).toThrow(InvalidPackLinkError);
	});

	it("builds links that parse back", () => {
		const locator = { packId: PACK_ID, packKey: PACK_KEY };

		expect(buildPackLink(locator)).toBe(`https://signal.art/addstickers/#${PARAMS}`);
		expect(parsePackLink(buildPackLink(locator))).toEqual(locator);
	});

	it("redacts pack ids like Signal", () => {
		expect(redactPackId(PACK_ID)).toBe("[REDACTED]ccf");
	});
});
