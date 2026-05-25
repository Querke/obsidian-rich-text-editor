import {
	Component,
	EventRef,
	FuzzySuggestModal,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Scope,
	TFile,
} from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import { RichTextEditor, RichTextEditorRef } from "./RichTextEditor";
import { mdxCalloutsToObsidian, obsidianCalloutsToMdx } from "./calloutPlugin";
import { expandInlineFootnotes } from "./footnotePlugin";
import { PropertyInfo } from "./PropertiesDisplay";

export class RichTextOverlay {
	private root: Root | null = null;
	private container: HTMLElement;

	private scope: Scope;
	private parentScope: Scope | null = null;

	private renameRef: EventRef;
	private modifyRef: EventRef;
	private metadataChangedRef: EventRef;
	private editorRef: RichTextEditorRef | null = null;
	private rawFrontmatter = "";

	// Full file text (incl. frontmatter) that this overlay last either
	// pushed to disk or pulled in. The vault `modify` listener compares this
	// against the current editor value to tell apart our own writes (skip)
	// from external changes — sync, Tasks plugin checkbox toggles, edits in
	// another tab, etc. (refresh).
	private lastSyncedFullText = "";

	constructor(public view: MarkdownView) {
		// Create the container inside the view's content element
		this.container = createDiv();

		if (!this.view.contentEl) {
			console.warn(
				"RichTextOverlay: No contentEl found on view. Skipping initialization.",
			);
			return;
		}

		// Check if the container already contains the Rich Text Overlay
		const existingOverlay =
			this.view.contentEl.querySelector(".rich-text-overlay");

		// Reusing a container that already has a React Root causes crashes/state issues.
		if (existingOverlay) {
			existingOverlay.remove();
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

		// Refresh the rich-text view when the underlying file changes from a
		// source other than us — external sync, the Tasks plugin toggling a
		// checkbox inside an embed, edits in another pane, etc. We compare
		// the current editor value to the last text we ourselves wrote/pulled
		// to filter out our own saves.
		// `vault.on("modify")` covers local edits in another pane, Tasks
		// plugin checkbox toggles, etc. `metadataCache.on("changed")` is the
		// catch-all that also covers Obsidian Sync writes (which can bypass
		// the regular modify dispatch). Both call the same refresh helper;
		// equality-check on lastSyncedFullText filters out our own saves.
		this.modifyRef = this.view.app.vault.on("modify", (file) => {
			if (file === this.view.file) this.refreshFromDisk();
		});
		this.metadataChangedRef = this.view.app.metadataCache.on(
			"changed",
			(file) => {
				if (file === this.view.file) this.refreshFromDisk();
			},
		);

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
			activeDocument.dispatchEvent(
				new CustomEvent("plugin:toggle-italic"),
			);
		});

		this.scope.register(["Mod"], "u", (evt) => {
			evt.preventDefault();
			activeDocument.dispatchEvent(
				new CustomEvent("plugin:toggle-underline"),
			);
		});

		this.scope.register(["Mod"], "k", (evt) => {
			evt.preventDefault();
			activeDocument.dispatchEvent(
				new CustomEvent("plugin:show-link-dialog"),
			);
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

		// Callouts: convert `:::callout` directives back to `> [!type]` syntax
		// before the newline-collapsing below touches the block structure.
		output = mdxCalloutsToObsidian(output);

		// 2. Reduce excessive newlines (Halve them: \n\n -> \n)
		output = output.replace(/\n{2,}/g, (m) =>
			"\n".repeat(Math.floor(m.length / 2)),
		);

		output = output.replace(
			/\[([^\]]+)\]\((tag:([^)]+))\)/g,
			(match: string, label: string, fullUrl: string, tag: string) => {
				// label is typically "#tag", but we don't rely on it
				const cleanTag = String(tag).trim();
				if (cleanTag.length === 0) {
					return match;
				}

				// Option 1 (recommended): plain tag syntax in Obsidian
				return `#${cleanTag}`;
			},
		);

		// Match standard markdown links: [Label](Url)
		output = output.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(match: string, label: string, url: string) => {
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
			// Replace every 2 spaces with 1 tab using an explicit quantifier
			return match.replace(/\x20{2}/g, "\t");
		});

		return output;
	};

	obsidianToMdx = (obsidian: string) => {
		// 1. Normalize line endings
		let normalized = obsidian.replace(/\r\n/g, "\n");

		// --- TAGS: #tag -> [#tag](tag:tag) ---
		normalized = normalized.replace(
			/(^|[\s([{>])#([A-Za-z0-9_/-]+)\b/gm,
			(match: string, prefix: string, tag: string) => {
				const cleanTag = String(tag).trim();
				if (cleanTag.length === 0) {
					return match;
				}
				return `${prefix}[#${cleanTag}](tag:${cleanTag})`;
			},
		);

		// Handle embeds ![[name]] / ![[name|alias]]. Images and other media
		// stay as image markdown (MDXEditor renders them). Note embeds are
		// downgraded to a regular link — otherwise MDXEditor treats the
		// encoded basename as an image src and tries (and fails) to load it.
		const MEDIA_EXT =
			/\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|mp4|mov|webm|mp3|wav|ogg|m4a|flac|pdf)$/i;
		normalized = normalized.replace(
			/!\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
			(_match: string, link: string, alias: string | undefined) => {
				const trimmed = link.trim();
				const label = alias?.trim() || trimmed;
				const encoded = encodeURI(trimmed);
				if (MEDIA_EXT.test(trimmed)) {
					return `![${label}](${encoded})`;
				}
				return `[${label}](${encoded})`;
			},
		);

		// A. Handle Aliased Wikilinks: [[Link|Alias]] -> [Alias](Link)
		normalized = normalized.replace(
			/\[\[([^|\]]+)\|([^\]]+)\]\]/g,
			(match: string, link: string, alias: string) => {
				// Encode the link path so MDXEditor accepts spaces (e.g. "My Note" -> "My%20Note")
				const encodedLink = encodeURI(link.trim());
				return `[${alias}](${encodedLink})`;
			},
		);

		// B. Handle Standard Wikilinks: [[Link]] -> [Link](Link)
		normalized = normalized.replace(
			/\[\[([^|\]]+)\]\]/g,
			(match: string, link: string) => {
				const encodedLink = encodeURI(link.trim());
				return `[${link}](${encodedLink})`;
			},
		);

		// Callouts: convert Obsidian `> [!type]` blockquotes into `:::callout`
		// directives. Done after links/tags so callout content is converted too.
		normalized = obsidianCalloutsToMdx(normalized);

		// Footnotes: expand Obsidian's `^[content]` shorthand to a regular
		// `[^id]` reference plus a definition appended at the end. Done before
		// the paragraph splitter so the generated definitions become their own
		// paragraph blocks.
		normalized = expandInlineFootnotes(normalized);

		// 2. MDXEditor NEEDS spaces for lists, but handles content tabs as entities
		normalized = normalized.replace(/([^\n\t])\t/g, "$1&#x9;");

		const lines = normalized.split("\n");
		const paragraphs: string[] = [];

		const isList = (line: string) => /^\s*(-|\*|\d+\.)\s/.test(line);
		// NEW: Check if line is a table row
		const isTable = (line: string) => line.trim().startsWith("|");

		// Tracks how deeply nested we are inside `:::callout` directive fences.
		// While inside one, every line is kept verbatim and joined with a
		// single newline so the directive block survives paragraph splitting.
		let directiveDepth = 0;

		// Holds the opening fence marker (``` or ~~~) while inside a fenced
		// code block. Every line of such a block is kept verbatim so multi-line
		// code — e.g. an Obsidian `tasks` query — is not exploded into
		// blank-line-separated paragraphs.
		let codeFence: string | null = null;

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			const isDirectiveOpen = /^(:{3,})callout\b/.test(line);
			const isDirectiveClose = /^:{3,}\s*$/.test(line);

			if (isDirectiveOpen || directiveDepth > 0) {
				if (isDirectiveOpen && directiveDepth === 0) {
					paragraphs.push(line);
				} else {
					paragraphs[paragraphs.length - 1] += "\n" + line;
				}
				if (isDirectiveOpen) {
					directiveDepth++;
				} else if (isDirectiveClose) {
					directiveDepth--;
				}
				continue;
			}

			// Fenced code blocks: keep every line verbatim (joined with a
			// single newline) so multi-line code — Tasks queries, JS, etc. —
			// stays a single block instead of being split into paragraphs.
			if (codeFence !== null) {
				paragraphs[paragraphs.length - 1] += "\n" + line;
				const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
				if (
					close &&
					close[1][0] === codeFence[0] &&
					close[1].length >= codeFence.length
				) {
					codeFence = null;
				}
				continue;
			}
			const fenceOpen = line.match(/^\s*(`{3,}|~{3,})/);
			if (fenceOpen) {
				codeFence = fenceOpen[1];
				paragraphs.push(line);
				continue;
			}

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

		// Drop blank paragraphs that sit between two footnote definitions.
		// Obsidian users often space definitions out visually (`[^1]: foo\n\n
		// [^2]: bar`) but the rich-text view should render them as a compact
		// list, the way Obsidian's own reading view does.
		const isFootnoteDef = (block: string) =>
			/^\s{0,3}\[\^[^\]\s]+\]:/.test(block);
		const isBlankBlock = (block: string) =>
			block === "&#x20;" || block.trim().length === 0;
		const compacted: string[] = [];
		for (let i = 0; i < paragraphs.length; i++) {
			const block = paragraphs[i];
			if (
				isBlankBlock(block) &&
				compacted.length > 0 &&
				isFootnoteDef(compacted[compacted.length - 1]) &&
				i + 1 < paragraphs.length &&
				isFootnoteDef(paragraphs[i + 1])
			) {
				continue;
			}
			compacted.push(block);
		}

		return compacted.join("\n\n");
	};

	private extractFrontmatter(text: string): { raw: string; body: string } {
		const match = text.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
		if (match) return { raw: match[1], body: text.slice(match[1].length) };
		return { raw: "", body: text };
	}

	private getProperties(): PropertyInfo[] {
		const file = this.view.file;
		if (!file) return [];

		const cache = this.view.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) return [];

		// @ts-ignore — metadataTypeManager is internal
		const typeManager = (this.view.app as any).metadataTypeManager;

		const resolveType = (key: string): string => {
			if (!typeManager) return "text";
			const p = typeManager.properties;
			if (p && typeof p === "object") {
				const entry = p instanceof Map ? p.get(key) : p[key];
				if (typeof entry === "string") return entry;
				if (entry?.widget) return entry.widget;
				if (entry?.type) return entry.type;
			}
			return "text";
		};

		return Object.entries(frontmatter)
			.filter(([key]) => key !== "position")
			.map(([key, value]) => ({
				key,
				value,
				type: resolveType(key),
			}));
	}

	update() {
		if (this.editorRef) {
			try {
				const rawText = this.view.editor.getValue();
				this.applyExternalText(rawText);
			} catch (e) {
				console.error(
					"RichTextOverlay: Failed to update editor content",
					e,
				);
			}
		} else {
			this.render();
		}
	}

	private refreshFromDisk() {
		if (this.root === null || !this.editorRef) return;
		const file = this.view.file;
		if (!file) return;
		void this.view.app.vault.cachedRead(file).then((freshText) => {
			if (this.root === null || !this.editorRef) return;
			if (freshText === this.lastSyncedFullText) return;
			this.applyExternalText(freshText);
		});
	}

	private applyExternalText(rawText: string) {
		if (!this.editorRef) return;
		this.lastSyncedFullText = rawText;
		const { raw, body } = this.extractFrontmatter(rawText);
		this.rawFrontmatter = raw;
		const cleanText = this.obsidianToMdx(body);
		this.editorRef.setMarkdown(cleanText);
		this.editorRef.setTitle(this.view.file?.basename || "Untitled");
		this.editorRef.setProperties(this.getProperties());
	}

	render() {
		if (!this.root || !this.view.editor) return;

		let initialText = "";
		try {
			const rawText = this.view.editor.getValue();
			this.lastSyncedFullText = rawText;
			const { raw, body } = this.extractFrontmatter(rawText);
			this.rawFrontmatter = raw;
			initialText = this.obsidianToMdx(body);
		} catch (e) {
			console.error("RichTextOverlay: Conversion failed", e);
			return;
		}

		const file = this.view.file;
		const initialProperties = this.getProperties();

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

		try {
			this.root.render(
				<StrictMode>
					<RichTextEditor
						ref={(node) => {
							this.editorRef = node;
						}}
						title={file?.basename || "Untitled"}
						text={initialText}
						properties={initialProperties}
						onSave={(newText) => {
							try {
								const cleanText = this.mdxToObsidian(newText);
								const fullText =
									this.rawFrontmatter + cleanText;
								this.lastSyncedFullText = fullText;
								this.view.editor.setValue(fullText);
								this.view.requestSave();
							} catch (e) {
								console.error(
									"RichTextOverlay: Save conversion failed",
									e,
								);
							}
						}}
						// Simple rename handler
						onRename={handleRename}
						onImageUpload={(file) => this.handleImageUpload(file)}
						onResolveImage={this.resolveImagePath}
						onPickInternalLink={this.pickInternalLink}
						onRenderEmbed={(el, lang, code) => {
							const component = new Component();
							component.load();
							const source = "```" + lang + "\n" + code + "\n```";
							void MarkdownRenderer.render(
								this.view.app,
								source,
								el,
								this.view.file?.path ?? "",
								component,
							);
							return () => component.unload();
						}}
						onNavigate={(path) => {
							// Use the void operator to handle the promise returned by openLinkText
							void this.view.app.workspace.openLinkText(
								path,
								this.view.file?.path || "",
								false,
							);
						}}
					/>
				</StrictMode>,
			);
		} catch (e) {
			console.error("RichTextOverlay: Render failed", e);
			console.error("Diagnostic - Problematic Markdown:", initialText);
		}
	}

	destroy() {
		this.view.app.vault.offref(this.renameRef);
		this.view.app.vault.offref(this.modifyRef);
		this.view.app.metadataCache.offref(this.metadataChangedRef);

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
		const vaultConfig = this.view.app
			.vault as typeof this.view.app.vault & {
			getConfig?: (key: string) => unknown;
		};
		const isReadable =
			vaultConfig.getConfig?.("readableLineLength") === true;

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

	private pickInternalLink = (): Promise<string | null> => {
		const app = this.view.app;
		const currentPath = this.view.file?.path || "";
		return new Promise((resolve) => {
			// Obsidian fires onClose BEFORE onChooseItem, so we can't resolve
			// in onClose directly — we'd always race to `null` even when a
			// file was picked. Instead, stash the chosen file and resolve on
			// a microtask after the modal tears down, so onChooseItem has a
			// chance to set `chosen` first.
			let chosen: string | null = null;
			let settled = false;
			const settle = (value: string | null) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};

			class FilePicker extends FuzzySuggestModal<TFile> {
				getItems(): TFile[] {
					return app.vault.getMarkdownFiles();
				}

				getItemText(item: TFile): string {
					return item.path;
				}

				onChooseItem(item: TFile): void {
					const link = app.metadataCache.fileToLinktext(
						item,
						currentPath,
						true,
					);
					chosen = link || item.basename;
				}

				onClose(): void {
					super.onClose();
					queueMicrotask(() => settle(chosen));
				}
			}

			const modal = new FilePicker(app);
			modal.setPlaceholder("Link to note…");
			modal.modalEl.addClass("rich-text-wikilink-picker");
			modal.open();
		});
	};

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
