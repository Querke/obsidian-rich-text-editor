// main.ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import { ExampleView, VIEW_TYPE_EXAMPLE } from "./ExampleView";

export default class HelloWorldPlugin extends Plugin {
	async onload() {
		this.registerView(
			VIEW_TYPE_EXAMPLE,
			(leaf: WorkspaceLeaf) => new ExampleView(leaf)
		);

		this.addRibbonIcon("dice", "Open Example View", () => {
			this.activateExampleView();
		});

		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		this.activateExampleView();
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_EXAMPLE);
	}

	async activateExampleView(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_EXAMPLE);
		const leaf =
			this.app.workspace.getRightLeaf(false) ??
			this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_EXAMPLE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}
