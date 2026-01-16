// ExampleView.tsx
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { RichTextEditor } from "./RichTextEditor";
import { TextFileView, WorkspaceLeaf, Notice, Scope } from "obsidian"; // + ViewStateResult

export const VIEW_TYPE_RICH_TEXT = "rich-text-view";

interface RichTextPlugin {
	manualToggle: (leaf: WorkspaceLeaf) => Promise<void>;
}

export class RichTextPluginView extends TextFileView {
	root: Root | null = null;
	currentContent: string = "";
	private plugin: RichTextPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: RichTextPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.scope = new Scope(this.app.scope);

		// Send to mdx editor: Ctrl+B to make it bold, Ctrl+I to make it italic, or Ctrl+U to underline it.  use Cmd+K to open the link dialog.

		this.scope.register(["Mod"], "b", (evt: KeyboardEvent) => {
			evt.preventDefault();
			window.dispatchEvent(new CustomEvent("plugin:toggle-bold"));
		});

		this.scope.register(["Mod"], "i", (evt) => {
			evt.preventDefault();
			document.dispatchEvent(new CustomEvent("plugin:toggle-italic"));
		});

		this.scope.register(["Mod"], "u", (evt) => {
			evt.preventDefault();
			document.dispatchEvent(new CustomEvent("plugin:toggle-underline"));
		});

		this.scope.register(["Mod"], "k", (evt) => {
			evt.preventDefault();
			document.dispatchEvent(new CustomEvent("plugin:show-link-dialog"));
		});

		// 4. Update the Action Button
		this.addAction("document", "Switch to Markdown Mode", async () => {
			await this.plugin.manualToggle(this.leaf); // Perform the switch
		});
	}

	getViewType(): string {
		return VIEW_TYPE_RICH_TEXT;
	}

	getDisplayText(): string {
		// Use this.file (provided by TextFileView)
		return this.file?.basename || "Rich Text";
	}

	// New: Helper for Obsidian to read our data
	getViewData(): string {
		return this.currentContent;
	}

	// New: Helper for Obsidian to set our data (on load)
	setViewData(data: string, clear: boolean): void {
		this.currentContent = data;
		this.render();
	}

	// New: Helper to clear the view
	clear(): void {
		this.currentContent = "";
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("rich-text-view-root"); // <-- add

		this.updateReadableLineLength();

		this.registerEvent(
			this.app.workspace.on("css-change", () =>
				this.updateReadableLineLength()
			)
		);
	}

	private onSave = (newText: string) => {
		this.currentContent = newText;
		this.requestSave(); // <-- Let Obsidian handle the saving
	};

	private render(): void {
		if (!this.root) {
			this.root = createRoot(this.contentEl);
		}

		const handleRename = async (nextBaseName: string): Promise<boolean> => {
			if (!this.file) return false;

			const dir =
				this.file.parent?.path === "/"
					? ""
					: this.file.parent?.path + "/";
			const newPath = dir + nextBaseName + "." + this.file.extension;

			try {
				// Just rename. Obsidian automatically updates 'this.file' for us.
				await this.app.fileManager.renameFile(this.file, newPath);
				return true;
			} catch (e) {
				new Notice("Rename failed: " + e);
				return false;
			}
		};

		this.root.render(
			<StrictMode>
				<RichTextEditor
					title={this.file?.basename ?? "Untitled"} // <-- Use this.file
					text={this.currentContent} // <-- Use local buffer
					onSave={this.onSave}
					onRename={handleRename}
					onImageUpload={(file) => this.handleImageUpload(file)}
					onResolveImage={this.resolveImagePath}
				/>
			</StrictMode>
		);
	}

	private updateReadableLineLength() {
		// @ts-ignore - access internal Obsidian config
		const isReadable = this.app.vault.getConfig("readableLineLength");
		this.contentEl.toggleClass("is-readable-line-width", isReadable);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	private async handleImageUpload(file: File): Promise<string> {
		const date = new Date();
		const timestamp = date
			.toISOString()
			.replace(/[-:T.]/g, "")
			.slice(0, 14);
		const extension = file.name.split(".").pop() || "png";
		const baseFilename = `Pasted image ${timestamp}.${extension}`;

		const filePath =
			await this.app.fileManager.getAvailablePathForAttachment(
				baseFilename,
				this.file?.path || ""
			);

		const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
		if (folderPath) {
			// Use adapter.mkdir which is often recursive or check existence
			if (!(await this.app.vault.adapter.exists(folderPath))) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		const buffer = await file.arrayBuffer();
		const createdFile = await this.app.vault.createBinary(filePath, buffer);

		const linkText = this.app.fileManager.generateMarkdownLink(
			createdFile,
			this.file?.path || ""
		);

		// This handles both Wiki-links ![[Path]] and Standard links ![](Path)
		let cleanPath = linkText;

		// // Remove Wiki-link brackets ![[...]]
		if (cleanPath.startsWith("[[") && cleanPath.endsWith("]]")) {
			cleanPath = cleanPath.slice(2, -2);
		}

		// 6. Decode URI component in case generateMarkdownLink encoded spaces
		return decodeURI(cleanPath);
	}

	private resolveImagePath = (src: string): string => {
		const decodedPath = decodeURI(src);
		const file = this.app.metadataCache.getFirstLinkpathDest(
			decodedPath,
			this.file?.path || ""
		);

		if (file) return this.app.vault.adapter.getResourcePath(file.path);

		return src;
	};
}
