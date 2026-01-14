// ExampleView.tsx
import {
	ItemView,
	MarkdownView,
	Notice,
	Scope,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { RichTextEditor } from "./RichTextEditor";

export const VIEW_TYPE_RICH_TEXT_EDITOR = "rich-text-view";

export class RichTextPluginView extends ItemView {
	root: Root | null = null;
	lastFilePath: string | null = null;
	text: string = "";

	// ExampleView.tsx

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

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
	}

	getViewType(): string {
		return VIEW_TYPE_RICH_TEXT_EDITOR;
	}

	getDisplayText(): string {
		return "Rich Text Editor";
	}

	private onSave = async (newText: string) => {
		const f = this.pickFile();
		if (f) {
			const textToSave = newText.replace(
				/!\[\]\((.*?)\)/g,
				(match, path) => {
					let cleanPath = path;

					// Remove wrapping <> if present (CommonMark syntax for paths with spaces)
					if (cleanPath.startsWith("<") && cleanPath.endsWith(">")) {
						cleanPath = cleanPath.slice(1, -1);
					}

					return `![[${decodeURI(cleanPath)}]]`;
				}
			);

			await this.app.vault.modify(f, textToSave);
		}
	};

	private pickFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (file instanceof TFile) {
			this.lastFilePath = file.path;
			return file;
		}

		if (this.lastFilePath) {
			const af = this.app.vault.getAbstractFileByPath(this.lastFilePath);
			if (af instanceof TFile) {
				return af;
			}
		}

		const mdLeaves = this.app.workspace.getLeavesOfType("markdown");
		if (mdLeaves.length > 0) {
			const f = (mdLeaves[0].view as MarkdownView).file;
			if (f) {
				this.lastFilePath = f.path;
				return f;
			}
		}

		return null;
	}

	private async loadText(): Promise<void> {
		const f = this.pickFile();
		let rawText = f ? await this.app.vault.read(f) : "";

		// CONVERT INPUT: Wiki-links ![[Link]] -> Standard ![](<Link>)
		// We use encodeURI to handle spaces in filenames which standard markdown hates
		this.text = rawText.replace(/!\[\[(.*?)\]\]/g, (match, path) => {
			return `![](${encodeURI(path)})`;
		});

		this.render();
	}

	private async handleImageUpload(file: File): Promise<string> {
		const date = new Date();
		const timestamp = date
			.toISOString()
			.replace(/[-:T.]/g, "")
			.slice(0, 14);
		const extension = file.name.split(".").pop() || "png";
		const baseFilename = `Pasted image ${timestamp}.${extension}`;

		// 1. Calculate the path based on user settings (Root, Subfolder, etc.)
		const filePath =
			await this.app.fileManager.getAvailablePathForAttachment(
				baseFilename,
				this.lastFilePath || ""
			);

		// 2. Ensure the folder exists (e.g. if creating a new "Assets" subfolder)
		const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
		if (folderPath) {
			// Use adapter.mkdir which is often recursive or check existence
			if (!(await this.app.vault.adapter.exists(folderPath))) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		// 3. Write the file
		const buffer = await file.arrayBuffer();
		const createdFile = await this.app.vault.createBinary(filePath, buffer);

		// 4. Generate the link text (e.g. "![[Image.png]]" or "![](Image.png)")
		const linkText = this.app.fileManager.generateMarkdownLink(
			createdFile,
			this.lastFilePath || ""
		);

		// 5. Extract just the path from the generated link
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
			this.lastFilePath || ""
		);

		if (file) return this.app.vault.adapter.getResourcePath(file.path);

		return src;
	};

	private render(): void {
		if (!this.root) {
			this.root = createRoot(this.contentEl);
		}

		const handleRename = async (nextBaseName: string): Promise<boolean> => {
			const cur = this.pickFile();
			if (!cur) {
				new Notice("No active file.");
				return false;
			}

			let proposed = nextBaseName.trim();
			if (proposed.endsWith("." + cur.extension)) {
				proposed = proposed.slice(0, -1 * (cur.extension.length + 1));
			}
			if (proposed.length === 0) {
				new Notice("Title cannot be empty.");
				return false;
			}
			// simple invalid char check
			if (/[\\/:*?"<>|#^]/.test(proposed)) {
				new Notice("Invalid characters in title.");
				return false;
			}

			const dir = cur.parent?.path ?? "";
			const newPath =
				(dir ? dir + "/" : "") + proposed + "." + cur.extension;

			if (this.app.vault.getAbstractFileByPath(newPath)) {
				new Notice("A file with that name already exists.");
				return false;
			}

			try {
				await this.app.fileManager.renameFile(cur, newPath);
				this.lastFilePath = newPath;
				new Notice("Renamed to " + proposed);
				await this.loadText();
				return true;
			} catch (e) {
				new Notice("Rename failed: " + e);
				return false;
			}
		};

		this.root.render(
			<StrictMode>
				<RichTextEditor
					title={this.pickFile()?.basename ?? ""}
					text={this.text}
					onSave={this.onSave}
					onRename={handleRename}
					onImageUpload={(file) => this.handleImageUpload(file)}
					onResolveImage={this.resolveImagePath}
				/>
			</StrictMode>
		);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("rich-text-view-root"); // <-- add
		await this.loadText();

		// 1. Initial check
		this.updateReadableLineLength();

		// 2. Listen for future changes (settings toggle)
		this.registerEvent(
			this.app.workspace.on("css-change", () =>
				this.updateReadableLineLength()
			)
		);

		await this.loadText();
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
}
