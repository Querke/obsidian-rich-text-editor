// footnotePlugin.tsx
//
// Markdown footnote support for MDXEditor.
//
// Markdown forms recognized:
//   [^id]            — inline footnote reference
//   [^id]: text      — block footnote definition (may span multiple indented lines)
//   ^[content]       — Obsidian's inline shorthand; normalized on import to a
//                      regular [^autoN] reference + definition appended at end.
//
// Refs and defs are renumbered for display in the order their definitions
// appear in the document, mirroring Obsidian's reading view:
//   - Each ref renders as a clickable superscript `[N]`.
//   - Each definition renders below an `hr` as a numbered list item whose body
//     is editable, with a back-link to the (first) referencing ref.
//
// Parsing is handled by `micromark-extension-gfm-footnote` + the matching
// `mdast-util-gfm-footnote`; this plugin only registers those extensions plus
// the Lexical nodes and import/export visitors that bridge them.

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { setIcon } from "obsidian";
import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	$nodesOfType,
	COMMAND_PRIORITY_HIGH,
	DecoratorNode,
	ElementNode,
	KEY_BACKSPACE_COMMAND,
} from "lexical";
import type {
	LexicalEditor,
	LexicalNode,
	NodeKey,
	SerializedElementNode,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
	addExportVisitor$,
	addImportVisitor$,
	addLexicalNode$,
	addMdastExtension$,
	addSyntaxExtension$,
	addToMarkdownExtension$,
	ButtonWithTooltip,
	createRootEditorSubscription$,
	realmPlugin,
	rootEditor$,
} from "@mdxeditor/editor";
import type {
	LexicalExportVisitor,
	MdastImportVisitor,
} from "@mdxeditor/editor";
import { useCellValue } from "@mdxeditor/gurx";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import {
	gfmFootnoteFromMarkdown,
	gfmFootnoteToMarkdown,
} from "mdast-util-gfm-footnote";

// --------------------------------------------------------------------------
// Inline `^[content]` shorthand
// --------------------------------------------------------------------------
//
// Standard GFM does not include `^[...]`. To support it we rewrite it to a
// normal `[^autoN]` reference plus a definition appended after the document.
// After a round-trip it stays in normalized form, which matches Obsidian's
// own reading-view (the shorthand is purely a typing convenience).

const INLINE_SHORTHAND_REGEX = /\^\[((?:[^\[\]\\]|\\.)*)\]/g;

/** Returns markdown with every `^[content]` replaced by `[^autoN]` and the
 *  generated definitions appended at the end of the document. */
export function expandInlineFootnotes(markdown: string): string {
	let counter = 0;
	const used = collectExistingIdentifiers(markdown);
	const appended: string[] = [];

	const out = markdown.replace(INLINE_SHORTHAND_REGEX, (_match, body: string) => {
		let id: string;
		do {
			counter++;
			id = `auto-fn-${counter}`;
		} while (used.has(id));
		used.add(id);
		appended.push(`[^${id}]: ${body.replace(/\\([\[\]])/g, "$1")}`);
		return `[^${id}]`;
	});

	if (appended.length === 0) {
		return out;
	}

	const tail = out.endsWith("\n") ? "" : "\n";
	return out + tail + "\n" + appended.join("\n\n") + "\n";
}

const EXISTING_DEF_REGEX = /^\s{0,3}\[\^([^\]\s]+)\]:/gm;
const EXISTING_REF_REGEX = /\[\^([^\]\s]+)\]/g;

function collectExistingIdentifiers(markdown: string): Set<string> {
	const ids = new Set<string>();
	let m: RegExpExecArray | null;
	EXISTING_DEF_REGEX.lastIndex = 0;
	while ((m = EXISTING_DEF_REGEX.exec(markdown))) {
		ids.add(m[1]);
	}
	EXISTING_REF_REGEX.lastIndex = 0;
	while ((m = EXISTING_REF_REGEX.exec(markdown))) {
		ids.add(m[1]);
	}
	return ids;
}

// --------------------------------------------------------------------------
// FootnoteReferenceNode — inline `[N]` superscript
// --------------------------------------------------------------------------

type SerializedFootnoteReferenceNode = Spread<
	{ identifier: string },
	SerializedLexicalNode
>;

export class FootnoteReferenceNode extends DecoratorNode<ReactElement> {
	__identifier: string;

	static getType(): string {
		return "footnote-reference";
	}

	static clone(node: FootnoteReferenceNode): FootnoteReferenceNode {
		return new FootnoteReferenceNode(node.__identifier, node.__key);
	}

	constructor(identifier: string, key?: NodeKey) {
		super(key);
		this.__identifier = identifier;
	}

	getIdentifier(): string {
		return this.getLatest().__identifier;
	}

	createDOM(): HTMLElement {
		const dom = document.createElement("sup");
		dom.className = "footnote-ref";
		dom.setAttribute("data-footnote-id", this.__identifier);
		return dom;
	}

	updateDOM(): boolean {
		return false;
	}

	isInline(): boolean {
		return true;
	}

	exportJSON(): SerializedFootnoteReferenceNode {
		return {
			type: "footnote-reference",
			version: 1,
			identifier: this.__identifier,
		};
	}

	static importJSON(
		json: SerializedFootnoteReferenceNode,
	): FootnoteReferenceNode {
		return $createFootnoteReferenceNode(json.identifier);
	}

	decorate(editor: LexicalEditor): ReactElement {
		return (
			<FootnoteReferenceView
				editor={editor}
				identifier={this.__identifier}
				nodeKey={this.__key}
			/>
		);
	}
}

export function $createFootnoteReferenceNode(
	identifier: string,
): FootnoteReferenceNode {
	return $applyNodeReplacement(new FootnoteReferenceNode(identifier));
}

export function $isFootnoteReferenceNode(
	node: LexicalNode | null | undefined,
): node is FootnoteReferenceNode {
	return node instanceof FootnoteReferenceNode;
}

// --------------------------------------------------------------------------
// FootnoteDefinitionNode — block element with editable body
// --------------------------------------------------------------------------

type SerializedFootnoteDefinitionNode = Spread<
	{ identifier: string },
	SerializedElementNode
>;

export class FootnoteDefinitionNode extends ElementNode {
	__identifier: string;

	static getType(): string {
		return "footnote-definition";
	}

	static clone(node: FootnoteDefinitionNode): FootnoteDefinitionNode {
		return new FootnoteDefinitionNode(node.__identifier, node.__key);
	}

	constructor(identifier: string, key?: NodeKey) {
		super(key);
		this.__identifier = identifier;
	}

	getIdentifier(): string {
		return this.getLatest().__identifier;
	}

	createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "footnote-def";
		dom.setAttribute("data-footnote-id", this.__identifier);
		return dom;
	}

	updateDOM(prevNode: FootnoteDefinitionNode, dom: HTMLElement): boolean {
		if (prevNode.__identifier !== this.__identifier) {
			dom.setAttribute("data-footnote-id", this.__identifier);
		}
		return false;
	}

	exportJSON(): SerializedFootnoteDefinitionNode {
		return {
			...super.exportJSON(),
			type: "footnote-definition",
			version: 1,
			identifier: this.__identifier,
		};
	}

	static importJSON(
		json: SerializedFootnoteDefinitionNode,
	): FootnoteDefinitionNode {
		return $createFootnoteDefinitionNode(json.identifier);
	}

	canBeEmpty(): boolean {
		return false;
	}

	canIndent(): boolean {
		return false;
	}

	isShadowRoot(): boolean {
		return true;
	}
}

export function $createFootnoteDefinitionNode(
	identifier: string,
): FootnoteDefinitionNode {
	return $applyNodeReplacement(new FootnoteDefinitionNode(identifier));
}

export function $isFootnoteDefinitionNode(
	node: LexicalNode | null | undefined,
): node is FootnoteDefinitionNode {
	return node instanceof FootnoteDefinitionNode;
}

// --------------------------------------------------------------------------
// FootnoteBackrefNode — ↩︎ that scrolls back to the reference
// --------------------------------------------------------------------------
//
// A decorator node so its DOM lives inside Lexical's reconciliation tree
// (avoids the MutationObserver loop that bit us with sibling-DOM injection).
// Always rendered as the last child of a FootnoteDefinitionNode and emits
// nothing on export.

type SerializedFootnoteBackrefNode = SerializedLexicalNode;

export class FootnoteBackrefNode extends DecoratorNode<ReactElement> {
	static getType(): string {
		return "footnote-backref";
	}

	static clone(node: FootnoteBackrefNode): FootnoteBackrefNode {
		return new FootnoteBackrefNode(node.__key);
	}

	static importJSON(): FootnoteBackrefNode {
		return $createFootnoteBackrefNode();
	}

	exportJSON(): SerializedFootnoteBackrefNode {
		return { type: "footnote-backref", version: 1 };
	}

	createDOM(): HTMLElement {
		const dom = document.createElement("span");
		dom.className = "footnote-backref-host";
		dom.contentEditable = "false";
		return dom;
	}

	updateDOM(): boolean {
		return false;
	}

	isInline(): boolean {
		return false;
	}

	decorate(editor: LexicalEditor): ReactElement {
		return <FootnoteBackrefView editor={editor} nodeKey={this.__key} />;
	}
}

export function $createFootnoteBackrefNode(): FootnoteBackrefNode {
	return $applyNodeReplacement(new FootnoteBackrefNode());
}

export function $isFootnoteBackrefNode(
	node: LexicalNode | null | undefined,
): node is FootnoteBackrefNode {
	return node instanceof FootnoteBackrefNode;
}

function FootnoteBackrefView(props: {
	editor: LexicalEditor;
	nodeKey: NodeKey;
}) {
	const { editor, nodeKey } = props;

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const identifier = editor.getEditorState().read(() => {
			const node = $getNodeByKey(nodeKey);
			const parent = node?.getParent();
			return $isFootnoteDefinitionNode(parent)
				? parent.getIdentifier()
				: null;
		});
		if (!identifier) return;
		const root = editor.getRootElement();
		const target = root?.querySelector<HTMLElement>(
			`.footnote-ref[data-footnote-id="${cssEscape(identifier)}"]`,
		);
		target?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<a
			className="footnote-backref"
			href="#"
			aria-label="Back to reference"
			title="Back to reference"
			onMouseDown={(event) => event.preventDefault()}
			onClick={handleClick}
		>
			↩︎
		</a>
	);
}

// --------------------------------------------------------------------------
// Reference React chrome
// --------------------------------------------------------------------------

function FootnoteReferenceView(props: {
	editor: LexicalEditor;
	identifier: string;
	nodeKey: NodeKey;
}) {
	const { editor, identifier } = props;

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const root = editor.getRootElement();
		const target = root?.querySelector<HTMLElement>(
			`.footnote-def[data-footnote-id="${cssEscape(identifier)}"]`,
		);
		target?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<a
			className="footnote-link"
			href={`#fn-${identifier}`}
			onClick={handleClick}
			title={`Go to footnote ${identifier}`}
		>
			[{identifier}]
		</a>
	);
}

function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && CSS.escape) {
		return CSS.escape(value);
	}
	return value.replace(/["\\\n\r]/g, "\\$&");
}

// --------------------------------------------------------------------------
// Definition number prefix / back-link
// --------------------------------------------------------------------------
//
// FootnoteDefinitionNode is an ElementNode (so the body is editable), which
// means we can't render React chrome via .decorate(). Instead, we mount a
// React component into a separate `.footnote-def-marker` DOM node that we
// keep in sync as a sibling host inside the def's DOM. The host is created
// once per def via a root-level subscription so it survives Lexical updates.

export function LucideIcon(props: { name: string; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.innerHTML = "";
		setIcon(el, props.name);
	}, [props.name]);
	return <span className={props.className} ref={ref} />;
}

// --------------------------------------------------------------------------
// Markdown <-> Lexical visitors
// --------------------------------------------------------------------------

interface FootnoteReferenceMdastNode {
	type: "footnoteReference";
	identifier: string;
	label?: string;
}

interface FootnoteDefinitionMdastNode {
	type: "footnoteDefinition";
	identifier: string;
	label?: string;
	children: unknown[];
}

const MdastFootnoteReferenceVisitor: MdastImportVisitor<never> = {
	testNode: (node) =>
		(node as unknown as { type: string }).type === "footnoteReference",
	visitNode({ mdastNode, lexicalParent }) {
		const ref = mdastNode as unknown as FootnoteReferenceMdastNode;
		const node = $createFootnoteReferenceNode(ref.identifier);
		(lexicalParent as ElementNode).append(node);
	},
};

const MdastFootnoteDefinitionVisitor: MdastImportVisitor<never> = {
	testNode: (node) =>
		(node as unknown as { type: string }).type === "footnoteDefinition",
	visitNode({ mdastNode, lexicalParent, actions }) {
		const def = mdastNode as unknown as FootnoteDefinitionMdastNode;
		const node = $createFootnoteDefinitionNode(def.identifier);
		(lexicalParent as ElementNode).append(node);
		actions.visitChildren(mdastNode as never, node);
		const last = node.getLastChild();
		if (!last || !$isElementNode(last)) {
			node.append($createParagraphNode());
		}
	},
};

const FootnoteReferenceLexicalVisitor: LexicalExportVisitor<
	FootnoteReferenceNode,
	never
> = {
	testLexicalNode: $isFootnoteReferenceNode,
	visitLexicalNode({ lexicalNode, actions }) {
		actions.addAndStepInto("footnoteReference", {
			identifier: lexicalNode.getIdentifier(),
		});
	},
};

const FootnoteDefinitionLexicalVisitor: LexicalExportVisitor<
	FootnoteDefinitionNode,
	never
> = {
	testLexicalNode: $isFootnoteDefinitionNode,
	visitLexicalNode({ lexicalNode, actions }) {
		actions.addAndStepInto("footnoteDefinition", {
			identifier: lexicalNode.getIdentifier(),
		});
	},
};

// The backref decorator is chrome — emit nothing on export.
const FootnoteBackrefLexicalVisitor: LexicalExportVisitor<
	FootnoteBackrefNode,
	never
> = {
	testLexicalNode: $isFootnoteBackrefNode,
	visitLexicalNode() {
		/* intentionally empty */
	},
};

// --------------------------------------------------------------------------
// Self-healing for definition nodes
// --------------------------------------------------------------------------

function healDefinition(node: FootnoteDefinitionNode): void {
	// Required structure: [paragraph, ...optional body, backref]. Heal both
	// ends — a missing paragraph would leave no caret target, a missing
	// backref would leave the def with no way back to its reference.
	const first = node.getFirstChild();
	if (!first || $isFootnoteBackrefNode(first)) {
		const paragraph = $createParagraphNode();
		if (first) {
			first.insertBefore(paragraph);
		} else {
			node.append(paragraph);
		}
	}
	const last = node.getLastChild();
	if (!$isFootnoteBackrefNode(last)) {
		node.append($createFootnoteBackrefNode());
	}
}

/**
 * Backspace handler for the footnote definition boundary:
 *  - Cursor at the start of an otherwise-empty def body → delete the whole
 *    def (and any references to it, so the document doesn't get left with
 *    orphan `[?]` superscripts pointing at nothing).
 *  - Cursor on the empty paragraph immediately after the last def → move the
 *    cursor into the def instead of deleting that paragraph (it's the only
 *    trailing cursor target below the footnote section).
 */
function handleFootnoteBackspace(event: KeyboardEvent | null): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return false;
	}
	if (selection.anchor.offset !== 0) {
		return false;
	}

	const anchorNode = selection.anchor.getNode();
	const paragraph = $isParagraphNode(anchorNode)
		? anchorNode
		: anchorNode.getParent();
	if (!$isParagraphNode(paragraph)) {
		return false;
	}

	const parent = paragraph.getParent();

	// Case 1: cursor inside a footnote def body. If the def's only body is
	// this empty paragraph, drop the whole def + matching refs.
	if ($isFootnoteDefinitionNode(parent)) {
		if (paragraph.getTextContentSize() !== 0) {
			return false;
		}
		// Body is everything except the trailing FootnoteBackrefNode.
		const bodyChildren = parent
			.getChildren()
			.filter((child) => !$isFootnoteBackrefNode(child));
		if (bodyChildren.length !== 1) {
			return false;
		}
		event?.preventDefault();
		const identifier = parent.getIdentifier();
		for (const ref of $nodesOfType(FootnoteReferenceNode)) {
			if (ref.getIdentifier() === identifier) {
				ref.remove();
			}
		}
		parent.remove();
		return true;
	}

	// Case 2: cursor on an empty paragraph that is the direct sibling after
	// a def. Move the caret into the def's body rather than deleting the
	// paragraph (defs need to be followed by a cursor target).
	if (paragraph.getTextContentSize() === 0) {
		const previous = paragraph.getPreviousSibling();
		if ($isFootnoteDefinitionNode(previous)) {
			event?.preventDefault();
			previous.selectEnd();
			return true;
		}
	}

	return false;
}

/** Ensure the document always ends with a plain paragraph after the last
 *  footnote definition, so the user has a cursor target below the list. */
function ensureTrailingParagraph(): void {
	const root = $getRoot();
	const last = root.getLastChild();
	if ($isFootnoteDefinitionNode(last)) {
		root.append($createParagraphNode());
	}
}

// --------------------------------------------------------------------------
// Plugin
// --------------------------------------------------------------------------

export const footnotePlugin = realmPlugin({
	init(realm) {
		realm.pubIn({
			[addSyntaxExtension$]: [gfmFootnote()],
			[addMdastExtension$]: [gfmFootnoteFromMarkdown()],
			[addToMarkdownExtension$]: [gfmFootnoteToMarkdown()],
			[addLexicalNode$]: [
				FootnoteReferenceNode,
				FootnoteDefinitionNode,
				FootnoteBackrefNode,
			],
			[addImportVisitor$]: [
				MdastFootnoteReferenceVisitor,
				MdastFootnoteDefinitionVisitor,
			],
			[addExportVisitor$]: [
				FootnoteReferenceLexicalVisitor,
				FootnoteDefinitionLexicalVisitor,
				FootnoteBackrefLexicalVisitor,
			],
		});

		realm.pub(createRootEditorSubscription$, (editor) => {
			const dispose = editor.registerNodeTransform(
				FootnoteDefinitionNode,
				healDefinition,
			);
			queueMicrotask(() => {
				editor.update(
					() => {
						for (const def of $nodesOfType(FootnoteDefinitionNode)) {
							healDefinition(def);
						}
						ensureTrailingParagraph();
					},
					{ tag: "history-merge" },
				);
			});
			const disposeBackspace = editor.registerCommand(
				KEY_BACKSPACE_COMMAND,
				handleFootnoteBackspace,
				COMMAND_PRIORITY_HIGH,
			);
			return () => {
				dispose();
				disposeBackspace();
			};
		});
	},
});

// --------------------------------------------------------------------------
// Toolbar button
// --------------------------------------------------------------------------

/** Lowest positive integer (as a string) not present in `taken`. Keeps
 *  toolbar-inserted footnotes readable as `[^1]`, `[^2]`, … in source mode. */
function nextNumericIdentifier(taken: Set<string>): string {
	let n = 1;
	while (taken.has(String(n))) {
		n++;
	}
	return String(n);
}

export function InsertFootnote() {
	const editor = useCellValue(rootEditor$);

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		if (!editor) return;

		editor.update(() => {
			// Generate an identifier that doesn't collide with anything that
			// already exists in the document.
			const taken = new Set<string>();
			for (const def of $nodesOfType(FootnoteDefinitionNode)) {
				taken.add(def.getIdentifier());
			}
			for (const ref of $nodesOfType(FootnoteReferenceNode)) {
				taken.add(ref.getIdentifier());
			}
			const id = nextNumericIdentifier(taken);

			// Insert the inline reference at the current caret synchronously,
			// before any other selection changes, so it always lands in the
			// user's text — not in the new def we're about to create.
			const selection = $getSelection();
			const ref = $createFootnoteReferenceNode(id);
			if ($isRangeSelection(selection)) {
				selection.insertNodes([ref]);
			} else {
				// No caret in the editor (e.g. focus was on the toolbar): drop
				// the ref at the end of the document body, before any defs.
				const root = $getRoot();
				const defs = root
					.getChildren()
					.filter($isFootnoteDefinitionNode);
				const insertionPoint = defs[0] ?? null;
				const paragraph = $createParagraphNode();
				paragraph.append(ref);
				if (insertionPoint) {
					insertionPoint.insertBefore(paragraph);
				} else {
					root.append(paragraph);
				}
			}

			// Append a matching empty definition to the footnote section. If
			// there are already defs, the new one goes right after the last
			// of them so it joins the compact list — appending blindly at
			// root end would place it after the trailing cursor-target
			// paragraph that sits below the section.
			const root = $getRoot();
			const def = $createFootnoteDefinitionNode(id);
			const body = $createParagraphNode();
			def.append(body);
			const existingDefs = root
				.getChildren()
				.filter($isFootnoteDefinitionNode);
			const lastDef = existingDefs[existingDefs.length - 1];
			if (lastDef) {
				lastDef.insertAfter(def);
			} else {
				root.append(def);
			}
			body.select();
		});
	};

	return (
		<ButtonWithTooltip title="Insert footnote" onClick={handleClick}>
			<LucideIcon name="file-pen-line" />
		</ButtonWithTooltip>
	);
}

// Suppress an unused-import lint warning for the helper above when it is only
// referenced from the toolbar button.
export { $insertNodeToNearestRoot };
