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
import { MarkdownEditorView } from "./MarkdownEditorView";

export const VIEW_TYPE_EXAMPLE = "example-view";

export class ExampleView extends ItemView {
	root: Root | null = null;
	lastFilePath: string | null = null;
	text: string = "";

	private onSave = async (newText: string) => {
		const f = this.pickFile();
		if (f) {
			// CONVERT OUTPUT: Standard ![](<Link>) -> Wiki-links ![[Link]]
			// We decodeURI to get spaces back
			const textToSave = newText.replace(
				/!\[\]\((.*?)\)/g,
				(match, path) => {
					return `![[${decodeURI(path)}]]`;
				}
			);

			await this.app.vault.modify(f, textToSave);
		}
	};

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
		return VIEW_TYPE_EXAMPLE;
	}

	getDisplayText(): string {
		return "Example view";
	}

	private pickFile(): TFile | null {
		console.log("picking file, last: ", this.lastFilePath);

		const file = this.app.workspace.getActiveFile();
		if (file instanceof TFile) {
			this.lastFilePath = file.path;
			console.log("setting: ", this.lastFilePath);

			return file;
		}

		if (this.lastFilePath) {
			console.log("opening last file path: " + this.lastFilePath);

			const af = this.app.vault.getAbstractFileByPath(this.lastFilePath);
			console.log(af);
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
		// Generate Obsidian-style timestamp name
		// Note: TypeScript might complain about moment(), you can use (window as any).moment() or standard Date
		const date = new Date();
		const timestamp = date
			.toISOString()
			.replace(/[-:T.]/g, "")
			.slice(0, 14);
		const extension = file.name.split(".").pop() || "png";
		const filename = `Pasted image ${timestamp}.${extension}`;

		const buffer = await file.arrayBuffer();

		// Save to vault root
		await this.app.vault.createBinary(filename, buffer);

		// Return the filename (MDXEditor will create ![](filename))
		return filename;
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
				<MarkdownEditorView
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
		this.contentEl.addClass("example-view-root"); // <-- add
		await this.loadText();

		// this.registerEvent(
		// 	this.app.workspace.on("file-open", async (file) => {
		// 		await this.loadText();
		// 	})
		// );

		// this.registerEvent(
		// 	this.app.vault.on("modify", async (f) => {
		// 		if (f instanceof TFile && f.path === this.lastFilePath) {
		// 			await this.loadText();
		// 		}
		// 	})
		// );
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
