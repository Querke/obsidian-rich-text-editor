import {
	Plugin,
	MarkdownView,
	WorkspaceLeaf,
	ItemView,
	TFile,
	setIcon,
	View,
} from "obsidian";
import { RichTextOverlay } from "./src/RichTextOverlay";
import "./src/view.css";
import "./src/mdxeditor.css";

interface RichTextView extends View {
	__richTextSwitchAction: HTMLElement;
	__hasRichTextSwitch?: boolean;
}

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
				if (leaf) void this.toggleMode(leaf);
			},
		});

		// 2. Injector: Watch for any leaf change (new tab, switch tab, etc.)
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf) {
					this.injectOverlay(leaf);
					this.addSwitchButton(leaf);
				}
			}),
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
									void this.toggleMode(targetLeaf);
								}
							});
					});
				}
			}),
		);

		// Trigger visibility check whenever the layout changes (e.g., switching to Reading Mode)
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.app.workspace.iterateAllLeaves((leaf) => {
					this.updateVisibility(leaf);
				});
			}),
		);

		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				// Update every active overlay
				this.app.workspace.iterateAllLeaves((leaf) => {
					if (this.overlays.has(leaf)) {
						this.overlays.get(leaf)?.updateReadableLineLength();
					}
				});
			}),
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
			if ((leaf.view as RichTextView).__hasRichTextSwitch) return;

			// FIX: Cast to ItemView to access addAction
			const switchAction = (leaf.view as ItemView).addAction(
				"candy",
				"Switch to Rich Text",
				() => {
					void this.toggleMode(leaf);
				},
			);

			(leaf.view as RichTextView).__richTextSwitchAction = switchAction;
			this.updateSwitchButtonIcon(leaf);

			// Mark this view as having the button
			(leaf.view as RichTextView).__hasRichTextSwitch = true;
		}
	}

	injectOverlay(leaf: WorkspaceLeaf) {
		if (leaf.view.getViewType() !== "markdown") return;
		if (!(leaf.view instanceof MarkdownView)) return;

		let overlay = this.overlays.get(leaf);

		// BUG FIX: Check if the overlay is attached to a dead view
		// If the Leaf is the same, but the View instance changed, our overlay is stale.
		if (overlay && overlay.view !== leaf.view) {
			overlay.destroy();
			this.overlays.delete(leaf);
			overlay = undefined;
		}

		// If we have a valid, living overlay, reuse it
		if (overlay) {
			overlay.update();
			this.updateVisibility(leaf);
			return;
		}

		// Otherwise, create a fresh one for the new View
		overlay = new RichTextOverlay(leaf.view);
		this.overlays.set(leaf, overlay);

		this.updateVisibility(leaf);
	}

	toggleMode(leaf: WorkspaceLeaf) {
		this.settings.isDefaultEditor = !this.settings.isDefaultEditor;
		void this.saveSettings();
		this.updateVisibility(leaf);
	}

	updateVisibility(leaf: WorkspaceLeaf) {
		// Fix: Cast to ItemView to access contentEl
		if (leaf.view.getViewType() != "markdown") {
			return;
		}

		const view = leaf.view as ItemView;
		const container = view.contentEl;
		const overlay = this.overlays.get(leaf);

		const isReadingMode = view.getState().mode === "preview";

		// Only show rich text if setting is ON AND we are NOT in reading mode
		if (this.settings.isDefaultEditor && !isReadingMode) {
			container.addClass("is-rich-text-mode");
			overlay?.update();
			overlay?.toggleScope(true);
		} else {
			container.removeClass("is-rich-text-mode");
			overlay?.toggleScope(false);
		}

		this.updateSwitchButtonIcon(leaf);
	}

	updateSwitchButtonIcon(leaf: WorkspaceLeaf) {
		const action = (leaf.view as RichTextView).__richTextSwitchAction as
			| HTMLElement
			| undefined;
		if (!action) return;

		// NEW: Detect reading mode
		const isReadingMode =
			(leaf.view as ItemView).getState().mode === "preview";

		// Hide the button if in reading mode, otherwise show it
		action.style.display = isReadingMode ? "none" : "";

		if (!isReadingMode) {
			const icon = this.settings.isDefaultEditor ? "candy-off" : "candy";
			setIcon(action, icon);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
		// Refresh all active leaves to reflect new setting
		this.app.workspace.iterateAllLeaves((leaf) =>
			this.updateVisibility(leaf),
		);
	}
}
