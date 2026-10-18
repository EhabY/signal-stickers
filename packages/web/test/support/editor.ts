import { render, screen } from "@testing-library/svelte";
import { vi } from "vitest";

import Editor from "../../src/components/Editor.svelte";
import type { Pack, ValidationIssue } from "../../src/lib/api.ts";
import type { PackImageTarget } from "../../src/lib/packSession.svelte.ts";
import { CATS, LIMITS } from "./api.ts";

export function animatedWebp(file: string): ValidationIssue {
	return { code: "unsupportedAnimation", message: `${file} is an animated WebP`, file };
}

export function renderEditor({
	pack = CATS,
	issues = [],
	converting = [],
}: { pack?: Pack; issues?: ValidationIssue[]; converting?: string[] } = {}) {
	const onchange = vi.fn<(pack: Pack) => void>();
	const onremove = vi.fn<(index: number, file: string) => void>();
	const oncover = vi.fn<(image: File) => void>();
	const onconvert = vi.fn<(targets: PackImageTarget[]) => void>();
	const { rerender } = render(Editor, {
		pack,
		issues,
		limits: LIMITS,
		imageUrl: (file) => `/stickers/${file}`,
		converting,
		onchange,
		onadd: vi.fn<(images: File[]) => void>(),
		onremove,
		oncover,
		onconvert,
	});
	return { onremove, oncover, onconvert, rerender, changed: () => onchange.mock.lastCall?.[0] };
}

export function imageSource(alt: string): string | null {
	return screen.getByAltText(alt).getAttribute("src");
}
