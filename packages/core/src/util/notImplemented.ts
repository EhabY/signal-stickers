/** Marks a contract whose implementation has not landed yet. */
export class NotImplementedError extends Error {
	override name = "NotImplementedError";

	constructor(feature: string) {
		super(`${feature} is not implemented yet`);
	}
}
