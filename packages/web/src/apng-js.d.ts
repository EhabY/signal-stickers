// Vite imports this CommonJS module as its exports object, not the default export its types describe.
declare module "apng-js" {
	import type parseAPNG from "apng-js/types/library/parser";

	const apngJs: Readonly<{ default: typeof parseAPNG }>;
	export default apngJs;
}
