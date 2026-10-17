import { mount } from "svelte";

import App from "./App.svelte";

const target = document.querySelector("#app");
if (!target) {
	throw new Error("Missing #app mount point");
}

export default mount(App, { target });
