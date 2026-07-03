import {
	Plugin,
	MarkdownView,
	WorkspaceLeaf,
	ItemView,
	TFile,
	setIcon,
	View,
	Editor,
} from "obsidian";
import { RichTextOverlay } from "./src/RichTextOverlay";

// Obsidian's command registry and Command callback shapes aren't fully in the
// public typings. We patch the search command objects directly (rather than the
// dispatch methods) because, when the rich-text overlay is focused, Obsidian
// sees no active CodeMirror editor and the built-in editor commands report
// themselves unavailable — so they never dispatch at all. Converting them to a
// checkCallback lets us control availability and capture every invocation path.
type EditorLike = Editor;
interface ObsidianCommand {
	id?: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
	editorCallback?: (editor: EditorLike, ctx: MarkdownView) => unknown;
	editorCheckCallback?: (
		checking: boolean,
		editor: EditorLike,
		ctx: MarkdownView,
	) => boolean | void;
}
interface CommandsRegistry {
	commands?: Record<string, ObsidianCommand>;
	editorCommands?: Record<string, ObsidianCommand>;
}

// The tab/view-header menu's "Find..." / "Replace..." items don't go through a
// command — they call `showSearch()` / `showSearch(true)` directly on the
// MarkdownView's editor mode. We patch that method's prototype too.
interface EditorSearchMode {
	showSearch?: (replace?: boolean) => unknown;
}

// Built-in find/replace commands we redirect into the rich-text search bar.
const SEARCH_COMMAND_ID = "editor:open-search";
const SEARCH_REPLACE_COMMAND_ID = "editor:open-search-replace";
import "./src/view.css";
import "./src/mdxeditor.css";

interface RichTextView extends View {
	__richTextSwitchAction?: HTMLElement;
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

		this.hijackSearchCommands();

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
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.iterateAllLeaves((leaf) => {
				this.injectOverlay(leaf);
				this.addSwitchButton(leaf);
			});
		});

		// add toggle to file menu select
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
				// Check if it's a markdown file
				if (file instanceof TFile && file.extension === "md") {
					// We simply add a checkable item.
					// Note: It will appear at the bottom of the menu (standard plugin behavior).
					menu.addItem((item) => {
						item.setIcon("candy");
						item.setTitle("Toggle rich text mode").onClick(() => {
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

	// Redirect Obsidian's built-in find / find-and-replace commands into our
	// rich-text search bar. We patch the command objects (not the dispatch
	// methods): when the overlay is focused Obsidian sees no active CodeMirror
	// editor, so the built-in editor commands report themselves unavailable and
	// never dispatch. Converting them to a checkCallback that reports available
	// while rich-text mode is active lets every invocation path reach us —
	// hotkeys, the command palette, the mobile toolbar "Find" and the context
	// menu. When rich-text mode is off we defer to the original behaviour.
	private hijackSearchCommands() {
		this.patchSearchCommand(SEARCH_COMMAND_ID, false);
		this.patchSearchCommand(SEARCH_REPLACE_COMMAND_ID, true);
	}

	// The view-header / tab menu's Find & Replace items call `showSearch()` on
	// the MarkdownView's editor mode instead of running a command. Patch that
	// method's prototype so it routes into our bar when rich-text mode is active.
	// Done lazily from injectOverlay because the editor mode (and thus its
	// prototype) only exists once a markdown view has been created.
	private editorSearchPatched = false;
	private patchEditorSearch(view: MarkdownView) {
		if (this.editorSearchPatched) return;

		const v = view as unknown as {
			editMode?: EditorSearchMode;
			currentMode?: EditorSearchMode;
			modes?: { source?: EditorSearchMode };
		};
		const mode = v.editMode ?? v.modes?.source ?? v.currentMode;
		if (!mode) return;

		const proto = Object.getPrototypeOf(mode) as EditorSearchMode | null;
		if (!proto || typeof proto.showSearch !== "function") return;

		const original = proto.showSearch;
		// Arrow closures over the plugin `this`, so the replacement keeps its
		// own runtime `this` (the editor mode) for `original.call(this, …)`
		// without aliasing `this` to a local variable. (Arrows are used rather
		// than `.bind`, which returns `any` here since strictBindCallApply is
		// off.)
		const isRichTextActive = () => this.isRichTextActive();
		const openSearchBar = (replace?: boolean) =>
			this.openSearchBar(!!replace);
		proto.showSearch = function (replace?: boolean) {
			if (isRichTextActive()) {
				openSearchBar(replace);
				return;
			}
			return original.call(this, replace);
		};
		this.editorSearchPatched = true;
		this.register(() => {
			proto.showSearch = original;
		});
	}

	private patchSearchCommand(id: string, replace: boolean) {
		const registry = (
			this.app as unknown as { commands?: CommandsRegistry }
		).commands;
		const cmd = registry?.commands?.[id] ?? registry?.editorCommands?.[id];
		if (!cmd) return;

		const original = {
			callback: cmd.callback,
			checkCallback: cmd.checkCallback,
			editorCallback: cmd.editorCallback,
			editorCheckCallback: cmd.editorCheckCallback,
		};
		// Arrow function so it closes over the plugin `this` (no `this` alias);
		// the original callbacks are invoked with `.call(cmd, …)` explicitly, so
		// this replacement never needs its own runtime `this`.
		cmd.checkCallback = (checking: boolean): boolean => {
			if (this.isRichTextActive()) {
				if (!checking) this.openSearchBar(replace);
				return true;
			}

			// Not in rich-text mode — fall back to the command's original
			// behaviour so the standard editor search still works.
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (original.editorCheckCallback && view) {
				const res = original.editorCheckCallback.call(
					cmd,
					checking,
					view.editor,
					view,
				);
				return checking ? (res ?? false) : true;
			}
			if (original.editorCallback && view) {
				if (!checking) {
					original.editorCallback.call(cmd, view.editor, view);
				}
				return true;
			}
			if (original.checkCallback) {
				const res = original.checkCallback.call(cmd, checking);
				return checking ? (res ?? false) : true;
			}
			if (original.callback) {
				if (!checking) original.callback.call(cmd);
				return true;
			}
			return false;
		};

		// checkCallback is overridden by the editor* callbacks, so drop those to
		// make sure ours is the one Obsidian consults.
		delete cmd.editorCheckCallback;
		delete cmd.editorCallback;

		this.register(() => {
			cmd.callback = original.callback;
			cmd.checkCallback = original.checkCallback;
			cmd.editorCallback = original.editorCallback;
			cmd.editorCheckCallback = original.editorCheckCallback;
		});
	}

	private openSearchBar(replace: boolean) {
		activeDocument.dispatchEvent(
			new CustomEvent("plugin:open-search", { detail: { replace } }),
		);
	}

	// True when the active markdown view is currently displaying the rich-text
	// overlay (rather than the standard source / reading view).
	private isRichTextActive(): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return !!view && view.contentEl.classList.contains("is-rich-text-mode");
	}

	onunload() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			// 1. Existing Cleanup: Remove overlays
			const overlay = this.overlays.get(leaf);
			if (overlay) {
				if (leaf.view.getViewType() === "markdown") {
					const container = (leaf.view as ItemView).contentEl;
					container.removeClass("is-rich-text-mode");
				}
				overlay.destroy();
			}

			// 2. NEW Cleanup: Remove the "Candy" button and reset flags
			if (leaf.view.getViewType() === "markdown") {
				const richView = leaf.view as RichTextView;

				// Remove the actual button from the DOM
				if (richView.__richTextSwitchAction) {
					richView.__richTextSwitchAction.remove();
					delete richView.__richTextSwitchAction;
				}

				// Reset the flag so onload() knows to add it again
				if (richView.__hasRichTextSwitch) {
					delete richView.__hasRichTextSwitch;
				}
			}
		});
	}

	addSwitchButton(leaf: WorkspaceLeaf) {
		if (
			leaf.view.getViewType() === "markdown" &&
			leaf.view instanceof ItemView
		) {
			// Check a custom flag to prevent duplicate buttons
			if ((leaf.view as RichTextView).__hasRichTextSwitch) return;

			const switchAction = leaf.view.addAction(
				"candy",
				"Switch to Rich Text",
				() => {
					void this.toggleMode(leaf);
				},
			);

			if (!switchAction) return;

			(leaf.view as RichTextView).__richTextSwitchAction = switchAction;
			this.updateSwitchButtonIcon(leaf);

			// Mark this view as having the button
			(leaf.view as RichTextView).__hasRichTextSwitch = true;
		}
	}

	injectOverlay(leaf: WorkspaceLeaf) {
		if (leaf.view.getViewType() !== "markdown") return;
		if (!(leaf.view instanceof MarkdownView)) return;

		this.patchEditorSearch(leaf.view);

		let overlay = this.overlays.get(leaf);

		// BUG FIX: Check if the overlay is attached to a dead view
		// If the Leaf is the same, but the View instance changed, our overlay is stale.
		if (overlay && overlay.view !== leaf.view) {
			overlay.destroy();
			this.overlays.delete(leaf);
			overlay = undefined;
		}

		// Safety Check: Ensure the view has a content element before injecting
		const view = leaf.view as ItemView;
		if (!view.contentEl) return;

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
		if (!container) return;

		const overlay = this.overlays.get(leaf);

		const isReadingMode = view.getState().mode === "preview";
		const shouldShow = this.settings.isDefaultEditor && !isReadingMode;
		const isShowing = container.hasClass("is-rich-text-mode");

		// Only show rich text if setting is ON AND we are NOT in reading mode
		if (shouldShow) {
			container.addClass("is-rich-text-mode");
			// Only sync content when transitioning from hidden to visible.
			// Calling update() on every layout-change (e.g. sidebar open/close)
			// replaces the editor content via setMarkdown(), which destroys
			// MDXEditor's internal scroll position.
			if (!isShowing) {
				overlay?.update();
			}
			overlay?.toggleScope(true);
		} else {
			container.removeClass("is-rich-text-mode");
			overlay?.toggleScope(false);
		}

		this.updateSwitchButtonIcon(leaf);
	}

	updateSwitchButtonIcon(leaf: WorkspaceLeaf) {
		const action = (leaf.view as RichTextView).__richTextSwitchAction;
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
		const savedSettings =
			(await this.loadData()) as Partial<RichTextPluginSettings> | null;

		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
	}
	async saveSettings() {
		await this.saveData(this.settings);
		// Refresh all active leaves to reflect new setting
		this.app.workspace.iterateAllLeaves((leaf) =>
			this.updateVisibility(leaf),
		);
	}
}
