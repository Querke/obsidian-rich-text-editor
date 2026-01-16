// main.ts
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import {
	RichTextPluginView,
	VIEW_TYPE_RICH_TEXT,
} from "./src/RichTextPluginView";

import "./src/mdxeditor.css";
import "./src/view.css";

interface RichTextPluginSettings {
	isDefaultEditor: boolean;
}

const DEFAULT_SETTINGS: RichTextPluginSettings = {
	isDefaultEditor: true,
};

export default class RichTextPlugin extends Plugin {
	private isDarkTheme: boolean | null = null;

	settings: RichTextPluginSettings;

	async onload() {
		await this.loadSettings(); // Load saved preference

		this.registerView(
			VIEW_TYPE_RICH_TEXT,
			(leaf: WorkspaceLeaf) => new RichTextPluginView(leaf, this)
		);

		// HACK: Inject "Switch to Rich Text" button into standard Markdown views
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf) this.addSwitchButton(leaf);
			})
		);

		// Also inject into any currently open leaves (e.g. on startup)
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.addSwitchButton(leaf);
		});

		// Command to Manually Toggle
		this.addCommand({
			id: "toggle-rich-text",
			name: "Toggle Rich Text / Markdown",
			callback: () => {
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) this.manualToggle(leaf);
			},
		});

		// AUTO-SWITCH LOGIC
		const checkAndReplace = async (leaf: WorkspaceLeaf | null) => {
			// 1. Basic checks
			if (!this.settings.isDefaultEditor || !leaf) return;

			// 2. Strict Check: Is this a Markdown View?
			// If getViewType returns "markdown", the view is ready. No timeout needed.
			if (leaf.view.getViewType() === "markdown") {
				console.log("replacing");
				const file = (leaf.view as any).file; // MarkdownView has a .file property
				if (file && file.extension === "md") {
					await leaf.setViewState({
						type: VIEW_TYPE_RICH_TEXT,
						state: { file: file.path },
					});
				}
			}
		};

		// Event 1: When navigating to a file (Same tab)
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				console.log("file open");

				checkAndReplace(this.app.workspace.getLeaf(false));
			})
		);

		// Event 2: When switching tabs or opening new splits
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				console.log("on active lead change");

				checkAndReplace(leaf);
			})
		);

		this.isDarkTheme = document.body.classList.contains("theme-dark");
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				const isDark = document.body.classList.contains("theme-dark");

				if (this.isDarkTheme !== isDark) {
					this.isDarkTheme = isDark;
				}
			})
		);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_RICH_TEXT);
	}

	private addSwitchButton(leaf: WorkspaceLeaf) {
		// Only target standard Markdown views
		if (leaf.view.getViewType() === "markdown") {
			// Check a custom flag to prevent duplicate buttons
			if ((leaf.view as any).__hasRichTextSwitch) return;

			// FIX: Cast to ItemView to access addAction
			(leaf.view as ItemView).addAction(
				"pencil",
				"Switch to Rich Text",
				() => {
					this.manualToggle(leaf);
				}
			);

			// Mark this view as having the button
			(leaf.view as any).__hasRichTextSwitch = true;
		}
	}

	async manualToggle(leaf: WorkspaceLeaf) {
		const currentView = leaf.view.getViewType();
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		if (currentView === "markdown") {
			// Switch TO Rich Text -> Enable & Save Setting
			this.settings.isDefaultEditor = true;
			await this.saveSettings();

			await leaf.setViewState({
				type: VIEW_TYPE_RICH_TEXT,
				state: { file: file.path },
			});
		} else {
			// Switch BACK TO Markdown -> Disable & Save Setting
			this.settings.isDefaultEditor = false;

			await this.saveSettings();

			await leaf.setViewState({
				type: "markdown",
				state: { file: file.path },
			});

			// Re-inject the button immediately after switching back
			// (Wait 1 tick for the new view to initialize)
			setTimeout(() => {
				const newLeaf = this.app.workspace.getLeaf(false);
				if (newLeaf) this.addSwitchButton(newLeaf);
			}, 50);
		}
	}

	// --- NEW CODE START ---
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	// --- NEW CODE END ---
}
