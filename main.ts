import { Plugin, MarkdownView, WorkspaceLeaf, ItemView, TFile } from "obsidian";
import { RichTextOverlay } from "./src/RichTextOverlay";
import "./src/view.css";
import "./src/mdxeditor.css";

interface RichTextPluginSettings {
	isDefaultEditor: boolean;
}
const DEFAULT_SETTINGS: RichTextPluginSettings = { isDefaultEditor: true };

export default class RichTextPlugin extends Plugin {
	settings: RichTextPluginSettings;

	// Track which leaves we have already injected into
	private overlays = new WeakMap<WorkspaceLeaf, RichTextOverlay>();

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "toggle-rich-text",
			name: "Toggle mode",
			callback: () => {
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) this.toggleMode(leaf);
			},
		});

		// 2. Injector: Watch for any leaf change (new tab, switch tab, etc.)
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf) {
					this.injectOverlay(leaf);
					this.addSwitchButton(leaf);
				}
			})
		);

		// 3. Initial Check: Inject into currently open leaves
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.injectOverlay(leaf);
			this.addSwitchButton(leaf);
		});

		// add toggle to file menu select
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
				// Check if it's a markdown file
				if (file instanceof TFile && file.extension === "md") {
					// We simply add a checkable item.
					// Note: It will appear at the bottom of the menu (standard plugin behavior).
					menu.addItem((item) => {
						item.setTitle("Rich text mode")
							.setChecked(this.settings.isDefaultEditor) // <-- Makes it a toggle
							.onClick(() => {
								// Use the specific leaf if clicked from header, otherwise active leaf
								const targetLeaf =
									leaf || this.app.workspace.getLeaf(false);
								if (targetLeaf) {
									this.toggleMode(targetLeaf);
								}
							});
					});
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				// Update every active overlay
				this.app.workspace.iterateAllLeaves((leaf) => {
					if (this.overlays.has(leaf)) {
						this.overlays.get(leaf)?.updateReadableLineLength();
					}
				});
			})
		);
	}

	onunload() {
		// Cleanup: Remove all our overlays
		this.app.workspace.iterateAllLeaves((leaf) => {
			const overlay = this.overlays.get(leaf);
			if (overlay) {
				if (leaf.view.getViewType() != "markdown") {
					return;
				}

				const container = (leaf.view as ItemView).contentEl;
				overlay.destroy();
				container.removeClass("is-rich-text-mode");
			}
		});
	}

	addSwitchButton(leaf: WorkspaceLeaf) {
		if (leaf.view.getViewType() === "markdown") {
			// Check a custom flag to prevent duplicate buttons
			if ((leaf.view as any).__hasRichTextSwitch) return;

			// FIX: Cast to ItemView to access addAction
			(leaf.view as ItemView).addAction(
				"sparkles",
				"Switch to Rich Text",
				() => {
					this.toggleMode(leaf);
				}
			);

			// Mark this view as having the button
			(leaf.view as any).__hasRichTextSwitch = true;
		}
	}

	injectOverlay(leaf: WorkspaceLeaf) {
		if (leaf.view.getViewType() !== "markdown") return;
		if (!(leaf.view instanceof MarkdownView)) return;

		// If overlay exists, just UPDATE it (Load new text) and show it
		if (this.overlays.has(leaf)) {
			const overlay = this.overlays.get(leaf);
			overlay?.update(); // <--- NEW: Force update
			this.updateVisibility(leaf);
			return;
		}

		const overlay = new RichTextOverlay(leaf.view);
		this.overlays.set(leaf, overlay);

		// Set initial state
		this.updateVisibility(leaf);
	}

	toggleMode(leaf: WorkspaceLeaf) {
		this.settings.isDefaultEditor = !this.settings.isDefaultEditor;
		this.saveSettings();
		this.updateVisibility(leaf);
	}

	updateVisibility(leaf: WorkspaceLeaf) {
		// Fix: Cast to ItemView to access contentEl
		if (leaf.view.getViewType() != "markdown") {
			return;
		}

		const container = (leaf.view as ItemView).contentEl;
		const overlay = this.overlays.get(leaf);

		if (this.settings.isDefaultEditor) {
			container.addClass("is-rich-text-mode");

			overlay?.update();
			overlay?.toggleScope(true);
		} else {
			container.removeClass("is-rich-text-mode");
			overlay?.toggleScope(false);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
		// Refresh all active leaves to reflect new setting
		this.app.workspace.iterateAllLeaves((leaf) =>
			this.updateVisibility(leaf)
		);
	}
}
