// obsidianEmbedPlugin.tsx
//
// Intercepts fenced code blocks whose language is handled by another Obsidian
// plugin (Tasks, Dataview, Mermaid, …) and renders them through Obsidian's
// own MarkdownRenderer instead of CodeMirror. The host supplies the actual
// render bridge via `setEditorEmbedRenderer` so this module never has to
// import `obsidian` directly.
//
// On-disk markdown is untouched: the node imports from / exports back to a
// regular ```lang\n…\n``` fenced block, so Obsidian's source view and the
// receiving plugin's MarkdownPostProcessor keep working unchanged.

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import {
	$applyNodeReplacement,
	DecoratorNode,
} from "lexical";
import type {
	LexicalEditor,
	LexicalNode,
	NodeKey,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import {
	addExportVisitor$,
	addImportVisitor$,
	addLexicalNode$,
	realmPlugin,
} from "@mdxeditor/editor";
import type {
	LexicalExportVisitor,
	MdastImportVisitor,
} from "@mdxeditor/editor";

// --------------------------------------------------------------------------
// Render bridge
// --------------------------------------------------------------------------

export type EmbedRenderer = (
	el: HTMLElement,
	lang: string,
	code: string,
) => () => void;

// The decorator needs to find the host-supplied renderer at render time.
// Stash it on the LexicalEditor instance — every decorator already gets the
// editor handed to it via `decorate(editor)`, so no extra plumbing needed.
type EditorWithEmbed = LexicalEditor & {
	__obsidianEmbedRenderer?: EmbedRenderer | null;
};

export function setEditorEmbedRenderer(
	editor: LexicalEditor,
	renderer: EmbedRenderer | null,
): void {
	(editor as EditorWithEmbed).__obsidianEmbedRenderer = renderer;
}

function getEditorEmbedRenderer(editor: LexicalEditor): EmbedRenderer | null {
	return (editor as EditorWithEmbed).__obsidianEmbedRenderer ?? null;
}

// --------------------------------------------------------------------------
// Which languages are intercepted
// --------------------------------------------------------------------------

const EMBED_LANGS = new Set([
	"tasks",
	"dataview",
	"dataviewjs",
	"mermaid",
]);

export function isEmbeddedLang(lang: string | null | undefined): boolean {
	return !!lang && EMBED_LANGS.has(lang.toLowerCase());
}

// --------------------------------------------------------------------------
// Lexical node
// --------------------------------------------------------------------------

type SerializedObsidianEmbedNode = Spread<
	{ lang: string; code: string },
	SerializedLexicalNode
>;

export class ObsidianEmbedNode extends DecoratorNode<ReactElement> {
	__lang: string;
	__code: string;

	static getType(): string {
		return "obsidian-embed";
	}

	static clone(node: ObsidianEmbedNode): ObsidianEmbedNode {
		return new ObsidianEmbedNode(node.__lang, node.__code, node.__key);
	}

	constructor(lang: string, code: string, key?: NodeKey) {
		super(key);
		this.__lang = lang;
		this.__code = code;
	}

	getLang(): string {
		return this.getLatest().__lang;
	}

	getCode(): string {
		return this.getLatest().__code;
	}

	createDOM(): HTMLElement {
		const dom = activeDocument.createElement("div");
		dom.className = "obsidian-embed";
		dom.setAttribute("data-embed-lang", this.__lang);
		dom.contentEditable = "false";
		return dom;
	}

	updateDOM(): boolean {
		return false;
	}

	exportJSON(): SerializedObsidianEmbedNode {
		return {
			type: "obsidian-embed",
			version: 1,
			lang: this.__lang,
			code: this.__code,
		};
	}

	static importJSON(json: SerializedObsidianEmbedNode): ObsidianEmbedNode {
		return $createObsidianEmbedNode(json.lang, json.code);
	}

	isInline(): boolean {
		return false;
	}

	decorate(editor: LexicalEditor): ReactElement {
		return (
			<ObsidianEmbedView
				editor={editor}
				lang={this.__lang}
				code={this.__code}
			/>
		);
	}
}

export function $createObsidianEmbedNode(
	lang: string,
	code: string,
): ObsidianEmbedNode {
	return $applyNodeReplacement(new ObsidianEmbedNode(lang, code));
}

export function $isObsidianEmbedNode(
	node: LexicalNode | null | undefined,
): node is ObsidianEmbedNode {
	return node instanceof ObsidianEmbedNode;
}

// --------------------------------------------------------------------------
// React view
// --------------------------------------------------------------------------

function ObsidianEmbedView(props: {
	editor: LexicalEditor;
	lang: string;
	code: string;
}) {
	const { editor, lang, code } = props;
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;

		const renderer = getEditorEmbedRenderer(editor);
		el.innerHTML = "";

		if (!renderer) {
			el.textContent = "```" + lang + "\n" + code + "\n```";
			el.classList.add("obsidian-embed-fallback");
			return;
		}

		el.classList.remove("obsidian-embed-fallback");
		const cleanup = renderer(el, lang, code);
		return () => {
			try {
				cleanup();
			} catch {
				/* ignore */
			}
			el.innerHTML = "";
		};
	}, [editor, lang, code]);

	return (
		<div
			className="obsidian-embed-host"
			contentEditable={false}
			ref={hostRef}
		/>
	);
}

// --------------------------------------------------------------------------
// Markdown <-> Lexical visitors
// --------------------------------------------------------------------------

interface MdastCodeNode {
	type: "code";
	lang?: string | null;
	meta?: string | null;
	value: string;
}

const MdastObsidianEmbedVisitor: MdastImportVisitor<MdastCodeNode> = {
	testNode: (node) => {
		const n = node as unknown as MdastCodeNode;
		return n.type === "code" && isEmbeddedLang(n.lang);
	},
	visitNode({ mdastNode, actions }) {
		actions.addAndStepInto(
			$createObsidianEmbedNode(
				(mdastNode.lang ?? "").toLowerCase(),
				mdastNode.value ?? "",
			),
		);
	},
	// Run before MDXEditor's default `code` visitor (priority 0).
	priority: 10,
};

const ObsidianEmbedLexicalVisitor: LexicalExportVisitor<
	ObsidianEmbedNode,
	never
> = {
	testLexicalNode: $isObsidianEmbedNode,
	visitLexicalNode({ lexicalNode, mdastParent, actions }) {
		actions.appendToParent(mdastParent, {
			type: "code",
			lang: lexicalNode.getLang(),
			meta: null,
			value: lexicalNode.getCode(),
		} as never);
	},
};

// --------------------------------------------------------------------------
// Plugin
// --------------------------------------------------------------------------

export const obsidianEmbedPlugin = realmPlugin({
	init(realm) {
		realm.pubIn({
			[addLexicalNode$]: [ObsidianEmbedNode],
			[addImportVisitor$]: [MdastObsidianEmbedVisitor],
			[addExportVisitor$]: [ObsidianEmbedLexicalVisitor],
		});
	},
});
