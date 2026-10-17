/** jsdom has no modal dialogs; this opens them, without the browser's focus trap. */
export function stubModalDialogs(): void {
	HTMLDialogElement.prototype.showModal = showModal;
}

function showModal(this: HTMLDialogElement): void {
	this.open = true;
}
