import { EventRef, MarkdownView, Notice, Scope, TFile } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import { RichTextEditor, RichTextEditorRef } from "./RichTextEditor";

export class RichTextOverlay {
	private root: Root | null = null;
	private container: HTMLElement;

	private scope: Scope;
	private parentScope: Scope | null = null;

	private renameRef: EventRef;
	private editorRef: RichTextEditorRef | null = null;

	constructor(public view: MarkdownView) {
		// Create the container inside the view's content element
		this.container = document.createElement("div");
		// Check if the container already contains the Rich Text Overlay
		const existingOverlay =
			this.view.contentEl.querySelector(".rich-text-overlay");

		if (existingOverlay) {
			this.container = existingOverlay as HTMLElement;
		}

		this.container.addClass("rich-text-overlay");

		// @ts-ignore
		if (this.view.app.isMobile) {
			this.container.addClass("is-mobile");
		}

		// Insert it BEFORE the standard editor so it sits at the top level
		this.view.contentEl.appendChild(this.container);

		this.renameRef = this.view.app.vault.on("rename", (file: TFile) => {
			if (file === this.view.file && this.root !== null) {
				this.editorRef?.setTitle(file.basename);
			}
		});

		// NEW: Initialize Scope (but don't activate it yet)
		// We use the view's app scope as the base
		this.scope = new Scope(this.view.app.scope);
		this.parentScope = this.view.scope; // Save the original markdown scope

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

		this.mount();
	}

	mount() {
		this.root = createRoot(this.container);
		this.updateReadableLineLength();
		this.render();
	}

	// Convert MDXEditor's "Spaces" structure back to Obsidian's "Tabs" (optional)
	mdxToObsidian = (text: string) => {
		// 1. Convert entities back to characters
		let output = text
			.replace(/&#x20;/g, " ")
			.replace(/&#x9;/g, "\t")
			.replace(/\r\n/g, "\n");

		// 2. Reduce excessive newlines (Halve them: \n\n -> \n)
		output = output.replace(/\n{2,}/g, (m) =>
			"\n".repeat(Math.floor(m.length / 2)),
		);

		// Match standard markdown links: [Label](Url)
		output = output.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(match, label, url) => {
				// A. Ignore External Links (http/https)
				if (url.startsWith("http://") || url.startsWith("https://")) {
					return match;
				}

				// B. Decode the URL (My%20Note -> My Note)
				const decodedUrl = decodeURI(url);

				// C. Check for Alias
				// If the label is different from the filename, use [[File|Label]]
				if (label !== decodedUrl) {
					return `[[${decodedUrl}|${label}]]`;
				}
				// Otherwise, just use [[File]]
				return `[[${decodedUrl}]]`;
			},
		);

		// OPTIONAL: If you strictly want TABS for list indentation in Obsidian
		// This converts 2-space indentation at start of lines into Tabs
		// Remove this block if you are happy with Spaces in Obsidian
		output = output.replace(/^(\s+)/gm, (match) => {
			// Replace every 2 spaces with 1 tab
			return match.replace(/  /g, "\t");
		});

		return output;
	};

	obsidianToMdx = (obsidian: string) => {
		// 1. Normalize line endings
		let normalized = obsidian.replace(/\r\n/g, "\n");

		// A. Handle Aliased Wikilinks: [[Link|Alias]] -> [Alias](Link)
		normalized = normalized.replace(
			/\[\[([^|\]]+)\|([^\]]+)\]\]/g,
			(match, link, alias) => {
				// Encode the link path so MDXEditor accepts spaces (e.g. "My Note" -> "My%20Note")
				const encodedLink = encodeURI(link.trim());
				return `[${alias}](${encodedLink})`;
			},
		);

		// B. Handle Standard Wikilinks: [[Link]] -> [Link](Link)
		normalized = normalized.replace(/\[\[([^|\]]+)\]\]/g, (match, link) => {
			const encodedLink = encodeURI(link.trim());
			return `[${link}](${encodedLink})`;
		});

		// 2. MDXEditor NEEDS spaces for lists, but handles content tabs as entities
		normalized = normalized.replace(/([^\n\t])\t/g, "$1&#x9;");

		const lines = normalized.split("\n");
		const paragraphs: string[] = [];

		const isList = (line: string) => /^\s*(-|\*|\d+\.)\s/.test(line);
		// NEW: Check if line is a table row
		const isTable = (line: string) => line.trim().startsWith("|");

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			// B. Convert Structural Indentation
			const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
			if (leadingWhitespace.includes("\t")) {
				const newPrefix = leadingWhitespace.replace(/\t/g, "  ");
				line = newPrefix + line.substring(leadingWhitespace.length);
			}

			// Restore your original empty line handling
			// This ensures vertical spacing is preserved exactly as you had it
			if (line.length === 0) {
				paragraphs.push("&#x20;");
				continue;
			}

			const withTrailingSpaces = line.replace(/[ ]+$/g, (m) =>
				"&#x20;".repeat(m.length),
			);

			// C. Smart Joining
			const prevLine = i > 0 ? lines[i - 1] : "";

			// Logic: Join with single \n if it's a continuing List OR a continuing Table
			const isTightList =
				isList(line) && isList(prevLine) && prevLine.trim().length > 0;
			const isTightTable =
				isTable(line) &&
				isTable(prevLine) &&
				prevLine.trim().length > 0;

			if (isTightList || isTightTable) {
				// Attach to previous block with single newline (preserves structure)
				paragraphs[paragraphs.length - 1] += "\n" + withTrailingSpaces;
			} else {
				// Otherwise start a new paragraph block (separated by \n\n later)
				paragraphs.push(withTrailingSpaces);
			}
		}

		return paragraphs.join("\n\n");
	};

	update() {
		if (this.editorRef) {
			const newText = this.view.editor.getValue();

			// const cleanText = newText.replace(/[ ]+(?=\n|$)/g, (m) => {
			// 	return "&#x20;".repeat(m.length);
			// });
			console.log(
				"obsidian text before convert",
				JSON.stringify(newText),
			);

			const cleanText = this.obsidianToMdx(newText);
			console.log(
				"obsidian text after convert",
				JSON.stringify(cleanText),
			);

			this.editorRef.setMarkdown(cleanText);
			this.editorRef.setTitle(this.view.file?.basename || "Untitled");
		} else {
			this.render();
		}
	}

	render() {
		if (!this.root) return;

		let initialText = this.obsidianToMdx(this.view.editor.getValue());

		const file = this.view.file;

		const handleRename = async (nextBaseName: string): Promise<boolean> => {
			if (!file) return false;

			const dir =
				file.parent?.path === "/" ? "" : file.parent?.path + "/";
			const newPath = dir + nextBaseName + "." + file.extension;

			try {
				await this.view.app.fileManager.renameFile(file, newPath);
				return true;
			} catch (e) {
				new Notice("Rename failed: " + e);
				return false;
			}
		};

		this.root.render(
			<StrictMode>
				<RichTextEditor
					ref={(node) => {
						this.editorRef = node;
					}}
					title={file?.basename || "Untitled"}
					text={initialText}
					onSave={(newText) => {
						console.log(
							"mdx before convert",
							JSON.stringify(newText),
						);
						const cleanText = this.mdxToObsidian(newText);
						console.log(
							"mdx text after convert: ",
							JSON.stringify(cleanText),
						);

						this.view.editor.setValue(cleanText);
						this.view.requestSave();
					}}
					// Simple rename handler
					onRename={handleRename}
					onImageUpload={(file) => this.handleImageUpload(file)}
					onResolveImage={this.resolveImagePath}
					onNavigate={(path) => {
						// Use Obsidian's API to open the link
						// 'this.view.file.path' is needed to resolve relative links (like "../Note")
						this.view.app.workspace.openLinkText(
							path,
							this.view.file?.path || "",
							false, // true = open in new tab, false = same tab
						);
					}}
				/>
			</StrictMode>,
		);
	}

	destroy() {
		this.view.app.vault.offref(this.renameRef);

		this.toggleScope(false);
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}

		this.container.remove();
	}

	toggleScope(active: boolean) {
		if (active) {
			this.view.scope = this.scope;
		} else {
			this.view.scope = this.parentScope;
		}
	}

	updateReadableLineLength() {
		// @ts-ignore - access internal Obsidian config via this.view.app
		const isReadable = this.view.app.vault.getConfig("readableLineLength");

		// Apply class to OUR container, not the parent contentEl
		this.container.toggleClass("is-readable-line-width", isReadable);
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
			await this.view.app.fileManager.getAvailablePathForAttachment(
				baseFilename,
				this.view.file?.path || "",
			);

		const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
		if (folderPath) {
			// Use adapter.mkdir which is often recursive or check existence
			if (!(await this.view.app.vault.adapter.exists(folderPath))) {
				await this.view.app.vault.createFolder(folderPath);
			}
		}

		const buffer = await file.arrayBuffer();
		const createdFile = await this.view.app.vault.createBinary(
			filePath,
			buffer,
		);

		const linkText = this.view.app.fileManager.generateMarkdownLink(
			createdFile,
			this.view.file?.path || "",
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
		const file = this.view.app.metadataCache.getFirstLinkpathDest(
			decodedPath,
			this.view.file?.path || "",
		);

		if (file) return this.view.app.vault.adapter.getResourcePath(file.path);

		return src;
	};
}
