// main.ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	RichTextPluginView,
	VIEW_TYPE_RICH_TEXT_EDITOR,
} from "./src/RichTextPluginView";

import "./src/view.css";
import "./src/mdxeditor.css";

export default class RichTextPlugin extends Plugin {
	private isDarkTheme: boolean | null = null;

	async onload() {
		this.registerView(
			VIEW_TYPE_RICH_TEXT_EDITOR,
			(leaf: WorkspaceLeaf) => new RichTextPluginView(leaf)
		);

		this.addRibbonIcon("pencil", "Open Rich Text Editor", () => {
			this.activateView();
		});

		this.isDarkTheme = document.body.classList.contains("theme-dark");
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				const isDark = document.body.classList.contains("theme-dark");

				if (this.isDarkTheme !== isDark) {
					this.isDarkTheme = isDark;
					this.activateView(); // reload view
				}
			})
		);

		this.activateView();
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RICH_TEXT_EDITOR);
	}

	async activateView(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RICH_TEXT_EDITOR);
		const leaf =
			this.app.workspace.getRightLeaf(false) ??
			this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: VIEW_TYPE_RICH_TEXT_EDITOR,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}
}
