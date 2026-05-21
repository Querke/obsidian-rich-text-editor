// calloutPlugin.tsx
//
// Obsidian callout support for MDXEditor.
//
// Callouts are represented in Markdown as remark container directives:
//
//   Obsidian markdown        <-->  MDXEditor markdown
//   > [!question] Title            :::callout{type="question" title="Title"}
//   > body                         body
//                                  :::
//
// A callout is a native Lexical block node so that nesting, deletion and undo
// all behave like ordinary editor content (no isolated sub-editors).
//
// Structure of a callout in the editor:
//
//   CalloutNode (ElementNode, shadow root)
//   ├── CalloutTitleNode (DecoratorNode)  — the non-editable title bar chrome
//   └── …body blocks…                     — ordinary editable content
//
// The title bar is its own keyed node (not foreign DOM) so Lexical's
// reconciler never displaces or deletes it.
//
//  - `obsidianCalloutsToMdx`  runs in RichTextOverlay.obsidianToMdx
//  - `mdxCalloutsToObsidian`  runs in RichTextOverlay.mdxToObsidian
//  - `calloutPlugin`          registers the nodes + import/export visitors
//  - `InsertCallout`          a toolbar button to insert a callout

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { setIcon } from "obsidian";
import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNodeByKey,
	$getSelection,
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
	SerializedElementNode,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
	addExportVisitor$,
	addImportVisitor$,
	addLexicalNode$,
	ButtonOrDropdownButton,
	createRootEditorSubscription$,
	realmPlugin,
	rootEditor$,
} from "@mdxeditor/editor";
import type { LexicalExportVisitor, MdastImportVisitor } from "@mdxeditor/editor";
import { useCellValue } from "@mdxeditor/gurx";

// --------------------------------------------------------------------------
// Type metadata
// --------------------------------------------------------------------------

// Lucide icon name for every Obsidian callout type, including aliases.
const CALLOUT_ICONS: Record<string, string> = {
	note: "pencil",
	abstract: "clipboard-list",
	summary: "clipboard-list",
	tldr: "clipboard-list",
	info: "info",
	todo: "check-circle-2",
	tip: "flame",
	hint: "flame",
	important: "flame",
	success: "check",
	check: "check",
	done: "check",
	question: "help-circle",
	help: "help-circle",
	faq: "help-circle",
	warning: "alert-triangle",
	caution: "alert-triangle",
	attention: "alert-triangle",
	failure: "x",
	fail: "x",
	missing: "x",
	danger: "zap",
	error: "zap",
	bug: "bug",
	example: "list",
	quote: "quote",
	cite: "quote",
};

// The canonical callout types offered by the toolbar's insert dropdown.
const CALLOUT_TYPES = [
	"note",
	"abstract",
	"info",
	"todo",
	"tip",
	"success",
	"question",
	"warning",
	"failure",
	"danger",
	"bug",
	"example",
	"quote",
] as const;

function iconFor(type: string): string {
	return CALLOUT_ICONS[type] ?? "pencil";
}

function defaultTitle(type: string): string {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

// --------------------------------------------------------------------------
// Attribute (de)serialization
// --------------------------------------------------------------------------

// Directive attribute values are double-quoted. We only ever introduce
// `&quot;` (never a raw `"`), which keeps the markdown unambiguous.
function encodeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function decodeAttr(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// --------------------------------------------------------------------------
// Obsidian markdown  -->  MDXEditor directive markdown
// --------------------------------------------------------------------------

const QUOTE_LINE = /^\s{0,3}>/;
const STRIP_QUOTE = /^\s{0,3}>[ \t]?/;
const CALLOUT_MARKER = /^\[!([\w-]+)\]([-+]?)[ \t]*(.*)$/;

/** Convert every Obsidian callout in `text` into a `:::callout` directive. */
export function obsidianCalloutsToMdx(text: string): string {
	return processObsidianLines(text.split("\n")).join("\n");
}

function processObsidianLines(lines: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		if (QUOTE_LINE.test(lines[i])) {
			let j = i;
			while (j < lines.length && QUOTE_LINE.test(lines[j])) {
				j++;
			}
			out.push(...renderQuoteRun(lines.slice(i, j)));
			i = j;
		} else {
			out.push(lines[i]);
			i++;
		}
	}
	return out;
}

/**
 * Convert one contiguous blockquote run. If its first non-blank line is a
 * callout marker, emit a directive; otherwise leave the blockquote untouched.
 */
function renderQuoteRun(run: string[]): string[] {
	// Strip exactly one level of `> ` so nested callouts surface as their own
	// blockquote runs when this content is reprocessed.
	const inner = run.map((line) => line.replace(STRIP_QUOTE, ""));

	const firstIdx = inner.findIndex((line) => line.trim().length > 0);
	if (firstIdx < 0) {
		return run; // entirely blank quote — leave as-is
	}

	const marker = inner[firstIdx].match(CALLOUT_MARKER);
	if (!marker) {
		return run; // plain blockquote — leave as-is
	}

	const type = marker[1].toLowerCase();
	const fold = marker[2] || "";
	const title = marker[3] || "";

	// The body may itself contain nested callouts, so recurse.
	const bodyLines = processObsidianLines(inner.slice(firstIdx + 1));

	// A container directive must use a *longer* colon fence than anything it
	// contains. bodyLines is already converted, so inspect its fences.
	let innerMaxFence = 0;
	for (const line of bodyLines) {
		const fenceMatch = line.match(/^(:{3,})/);
		if (fenceMatch && fenceMatch[1].length > innerMaxFence) {
			innerMaxFence = fenceMatch[1].length;
		}
	}
	const fence = ":".repeat(Math.max(3, innerMaxFence + 1));

	let attrs = `type="${encodeAttr(type)}"`;
	if (title) {
		attrs += ` title="${encodeAttr(title)}"`;
	}
	if (fold) {
		attrs += ` fold="${fold}"`;
	}

	return [`${fence}callout{${attrs}}`, ...bodyLines, fence];
}

// --------------------------------------------------------------------------
// MDXEditor directive markdown  -->  Obsidian markdown
// --------------------------------------------------------------------------

const DIRECTIVE_OPEN = /^(:{3,})callout\b/;
const DIRECTIVE_CLOSE = /^(:{3,})\s*$/;

/** Convert every `:::callout` directive in `text` back into an Obsidian callout. */
export function mdxCalloutsToObsidian(text: string): string {
	return processMdxLines(text.split("\n")).join("\n");
}

function processMdxLines(lines: string[]): string[] {
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = lines[i].match(DIRECTIVE_OPEN);
		if (!open) {
			out.push(lines[i]);
			i++;
			continue;
		}

		const fenceLen = open[1].length;

		// Parse attributes between the first `{` and the last `}`.
		const lb = lines[i].indexOf("{");
		const rb = lines[i].lastIndexOf("}");
		const attrs =
			lb >= 0 && rb > lb
				? parseAttrs(lines[i].slice(lb + 1, rb))
				: {};

		// The matching close fence is the next colon-only line that is at
		// least as long as the opening fence (nested fences are shorter).
		let k = i + 1;
		while (k < lines.length) {
			const close = lines[k].match(DIRECTIVE_CLOSE);
			if (close && close[1].length >= fenceLen) {
				break;
			}
			k++;
		}

		const bodyLines = processMdxLines(lines.slice(i + 1, k));

		const type = attrs.type || "note";
		const fold = attrs.fold || "";
		const title = attrs.title ? decodeAttr(attrs.title) : "";
		const header = `[!${type}]${fold}${title ? " " + title : ""}`;

		for (const line of [header, ...bodyLines]) {
			out.push(line.length ? "> " + line : ">");
		}

		i = k < lines.length ? k + 1 : k;
	}
	return out;
}

function parseAttrs(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(source))) {
		result[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
	}
	return result;
}

// --------------------------------------------------------------------------
// CalloutNode — a native Lexical block node
// --------------------------------------------------------------------------

type SerializedCalloutNode = Spread<
	{ calloutType: string; title: string; fold: string },
	SerializedElementNode
>;

/**
 * A block-level callout. Its first child is a {@link CalloutTitleNode}; the
 * remaining children are the editable body. Type/title/fold live here.
 */
export class CalloutNode extends ElementNode {
	__calloutType: string;
	__title: string;
	__fold: string;

	static getType(): string {
		return "callout";
	}

	static clone(node: CalloutNode): CalloutNode {
		return new CalloutNode(
			node.__calloutType,
			node.__title,
			node.__fold,
			node.__key,
		);
	}

	constructor(calloutType = "note", title = "", fold = "", key?: string) {
		super(key);
		this.__calloutType = calloutType;
		this.__title = title;
		this.__fold = fold;
	}

	getCalloutType(): string {
		return this.getLatest().__calloutType;
	}

	getTitle(): string {
		return this.getLatest().__title;
	}

	getFold(): string {
		return this.getLatest().__fold;
	}

	setTitle(title: string): void {
		this.getWritable().__title = title;
	}

	setCalloutType(calloutType: string): void {
		this.getWritable().__calloutType = calloutType;
	}

	createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "callout";
		dom.setAttribute("data-callout", this.__calloutType);
		dom.setAttribute("data-callout-fold", this.__fold);
		if (this.__fold === "-") {
			dom.classList.add("is-collapsed");
		}
		return dom;
	}

	updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
		if (prevNode.__calloutType !== this.__calloutType) {
			dom.setAttribute("data-callout", this.__calloutType);
		}
		if (prevNode.__fold !== this.__fold) {
			dom.setAttribute("data-callout-fold", this.__fold);
		}
		return false;
	}

	exportJSON(): SerializedCalloutNode {
		return {
			...super.exportJSON(),
			type: "callout",
			version: 1,
			calloutType: this.__calloutType,
			title: this.__title,
			fold: this.__fold,
		};
	}

	static importJSON(json: SerializedCalloutNode): CalloutNode {
		return $createCalloutNode(json.calloutType, json.title, json.fold);
	}

	canBeEmpty(): boolean {
		return false;
	}

	canIndent(): boolean {
		return false;
	}

	// Treat the callout as a containment boundary: block editing behaves like
	// a mini-document, and a backspace inside the body cannot delete it.
	isShadowRoot(): boolean {
		return true;
	}
}

export function $createCalloutNode(
	calloutType = "note",
	title = "",
	fold = "",
): CalloutNode {
	return $applyNodeReplacement(new CalloutNode(calloutType, title, fold));
}

export function $isCalloutNode(
	node: LexicalNode | null | undefined,
): node is CalloutNode {
	return node instanceof CalloutNode;
}

// --------------------------------------------------------------------------
// CalloutTitleNode — the non-editable title bar
// --------------------------------------------------------------------------

type SerializedCalloutTitleNode = SerializedLexicalNode;

/**
 * The title bar of a callout. A decorator node, so it carries no Lexical
 * children and the reconciler never touches the chrome it renders. It reads
 * its parent {@link CalloutNode} for the type/title/fold to display.
 */
export class CalloutTitleNode extends DecoratorNode<ReactElement> {
	static getType(): string {
		return "callout-title";
	}

	static clone(node: CalloutTitleNode): CalloutTitleNode {
		return new CalloutTitleNode(node.__key);
	}

	static importJSON(): CalloutTitleNode {
		return $createCalloutTitleNode();
	}

	exportJSON(): SerializedCalloutTitleNode {
		return { type: "callout-title", version: 1 };
	}

	createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "callout-title-host";
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
		return <CalloutTitleBar editor={editor} titleKey={this.__key} />;
	}
}

export function $createCalloutTitleNode(): CalloutTitleNode {
	return $applyNodeReplacement(new CalloutTitleNode());
}

export function $isCalloutTitleNode(
	node: LexicalNode | null | undefined,
): node is CalloutTitleNode {
	return node instanceof CalloutTitleNode;
}

// --------------------------------------------------------------------------
// Title bar React chrome
// --------------------------------------------------------------------------

/** A `<div>` whose content is a Lucide icon, rendered via Obsidian's setIcon. */
function LucideIcon(props: { name: string; className?: string }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		el.innerHTML = "";
		setIcon(el, props.name);
	}, [props.name]);
	return <div className={props.className} ref={ref} />;
}

interface CalloutInfo {
	calloutKey: string;
	type: string;
	title: string;
	fold: string;
}

/** Reads the parent CalloutNode's display info for the given title node. */
function readCalloutInfo(
	editor: LexicalEditor,
	titleKey: string,
): CalloutInfo | null {
	return editor.getEditorState().read(() => {
		const titleNode = $getNodeByKey(titleKey);
		const parent = titleNode?.getParent();
		if ($isCalloutNode(parent)) {
			return {
				calloutKey: parent.getKey(),
				type: parent.getCalloutType(),
				title: parent.getTitle(),
				fold: parent.getFold(),
			};
		}
		return null;
	});
}

/** The editable title input. Commits on blur so typing isn't per-keystroke undo. */
function TitleInput(props: {
	editor: LexicalEditor;
	calloutKey: string;
	title: string;
	placeholder: string;
}) {
	const [value, setValue] = useState(props.title);
	// Re-sync if the title changes elsewhere (e.g. undo).
	useEffect(() => setValue(props.title), [props.title]);

	const commit = () => {
		props.editor.update(() => {
			const node = $getNodeByKey(props.calloutKey);
			if ($isCalloutNode(node) && node.getTitle() !== value) {
				node.setTitle(value);
			}
		});
	};

	return (
		<input
			className="callout-title-inner callout-title-input"
			value={value}
			placeholder={props.placeholder}
			onChange={(event) => setValue(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function CalloutTitleBar(props: { editor: LexicalEditor; titleKey: string }) {
	const { editor, titleKey } = props;
	const [info, setInfo] = useState<CalloutInfo | null>(() =>
		readCalloutInfo(editor, titleKey),
	);

	useEffect(() => {
		return editor.registerUpdateListener(() => {
			const next = readCalloutInfo(editor, titleKey);
			setInfo((prev) => {
				if (
					prev &&
					next &&
					prev.calloutKey === next.calloutKey &&
					prev.type === next.type &&
					prev.title === next.title &&
					prev.fold === next.fold
				) {
					return prev;
				}
				return next;
			});
		});
	}, [editor, titleKey]);

	if (!info) {
		return <div className="callout-title" dir="auto" />;
	}

	const { calloutKey, type, title, fold } = info;
	const foldable = fold === "+" || fold === "-";

	return (
		<div className="callout-title" dir="auto">
			<LucideIcon className="callout-icon" name={iconFor(type)} />
			<TitleInput
				editor={editor}
				calloutKey={calloutKey}
				title={title}
				placeholder={defaultTitle(type)}
			/>
			{foldable && (
				<div
					className="callout-fold"
					role="button"
					aria-label="Toggle callout"
					onClick={() => {
						editor
							.getElementByKey(calloutKey)
							?.classList.toggle("is-collapsed");
					}}
				>
					<LucideIcon name="chevron-down" />
				</div>
			)}
			<button
				type="button"
				className="callout-remove"
				aria-label="Remove callout"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => {
					editor.update(() => {
						$getNodeByKey(calloutKey)?.remove();
					});
				}}
			>
				<LucideIcon name="trash-2" />
			</button>
		</div>
	);
}

// --------------------------------------------------------------------------
// Markdown <-> Lexical visitors
// --------------------------------------------------------------------------

interface ContainerDirectiveMdastNode {
	type: "containerDirective";
	name: string;
	attributes?: Record<string, string | null | undefined> | null;
	children: unknown[];
}

// Import: a `:::callout` container directive becomes a CalloutNode. Priority 1
// ensures this runs before the directives plugin's generic directive visitor.
const MdastCalloutVisitor: MdastImportVisitor<never> = {
	priority: 1,
	testNode: (node) =>
		node.type === "containerDirective" &&
		(node as unknown as ContainerDirectiveMdastNode).name === "callout",
	visitNode({ mdastNode, lexicalParent, actions }) {
		const directive = mdastNode as unknown as ContainerDirectiveMdastNode;
		const attributes = directive.attributes ?? {};
		const node = $createCalloutNode(
			attributes.type || "note",
			attributes.title ? decodeAttr(attributes.title) : "",
			attributes.fold || "",
		);
		node.append($createCalloutTitleNode());
		// Append the callout, then visit the directive's children as its body.
		(lexicalParent as ElementNode).append(node);
		actions.visitChildren(mdastNode as never, node);
		// Ensure the body ends with a paragraph (a cursor target). Done here —
		// not just via the node transform — because transforms do not run on
		// the document that is imported when the editor first loads.
		if (!$isParagraphNode(node.getLastChild())) {
			node.append($createParagraphNode());
		}
	},
};

// Export: a CalloutNode becomes a `:::callout` container directive.
const CalloutLexicalVisitor: LexicalExportVisitor<CalloutNode, never> = {
	testLexicalNode: $isCalloutNode,
	visitLexicalNode({ lexicalNode, actions }) {
		const attributes: Record<string, string> = {
			type: lexicalNode.getCalloutType(),
		};
		const title = lexicalNode.getTitle();
		if (title) {
			attributes.title = encodeAttr(title);
		}
		const fold = lexicalNode.getFold();
		if (fold) {
			attributes.fold = fold;
		}
		actions.addAndStepInto("containerDirective", {
			name: "callout",
			attributes,
		});
	},
};

// Export: the title bar carries no Markdown of its own (it is stored as the
// directive's attributes), so it produces nothing.
const CalloutTitleLexicalVisitor: LexicalExportVisitor<
	CalloutTitleNode,
	never
> = {
	testLexicalNode: $isCalloutTitleNode,
	visitLexicalNode() {
		/* intentionally empty — see comment above */
	},
};

/**
 * Keeps every CalloutNode well-formed:
 *  - a CalloutTitleNode as the first child (self-heals a deleted title);
 *  - a paragraph as the last *body* child, so the body ends in a cursor
 *    target rather than a nested callout / list / image;
 *  - a block sibling *after* the callout, so there is always a text block
 *    below it that the user can edit.
 */
function healCallout(node: CalloutNode): void {
	const first = node.getFirstChild();
	if (!$isCalloutTitleNode(first)) {
		const titleNode = $createCalloutTitleNode();
		if (first) {
			first.insertBefore(titleNode);
		} else {
			node.append(titleNode);
		}
	}
	if (!$isParagraphNode(node.getLastChild())) {
		node.append($createParagraphNode());
	}
	// A callout must always be followed by a *non-callout* text block. Two
	// adjacent callouts with nothing between them merge into one when the
	// document round-trips through Obsidian's blockquote callout syntax.
	const next = node.getNextSibling();
	if (next === null || $isCalloutNode(next)) {
		node.insertAfter($createParagraphNode());
	}
}

/**
 * Backspace handler for the callout boundary (a CalloutNode is a shadow root,
 * so these would otherwise behave wrongly):
 *
 *  - cursor in an otherwise-empty callout body -> delete the whole callout;
 *  - cursor on the empty line right after a callout -> keep that line (a
 *    callout must always be followed by a text block) and just move the
 *    cursor into the callout.
 */
function handleCalloutBackspace(event: KeyboardEvent | null): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return false;
	}
	const anchorNode = selection.anchor.getNode();
	const paragraph = $isParagraphNode(anchorNode)
		? anchorNode
		: anchorNode.getParent();
	if (!$isParagraphNode(paragraph) || paragraph.getChildrenSize() !== 0) {
		return false;
	}

	// The body is empty when the callout has only its title + this paragraph.
	const parent = paragraph.getParent();
	if ($isCalloutNode(parent) && parent.getChildrenSize() === 2) {
		event?.preventDefault();
		parent.remove();
		return true;
	}

	// The empty line directly after a callout is mandatory — don't delete it,
	// just move the cursor into the callout.
	const previous = paragraph.getPreviousSibling();
	if ($isCalloutNode(previous)) {
		event?.preventDefault();
		previous.selectEnd();
		return true;
	}

	return false;
}

/**
 * Registers callout support. Requires the `directivesPlugin` to also be
 * enabled — that plugin provides the directive Markdown grammar; this one
 * provides the nodes and the callout-specific import/export visitors.
 */
export const calloutPlugin = realmPlugin({
	init(realm) {
		realm.pubIn({
			[addImportVisitor$]: MdastCalloutVisitor,
			[addLexicalNode$]: [CalloutNode, CalloutTitleNode],
			[addExportVisitor$]: [
				CalloutLexicalVisitor,
				CalloutTitleLexicalVisitor,
			],
		});
		realm.pub(createRootEditorSubscription$, (editor) => {
			const dispose = editor.registerNodeTransform(
				CalloutNode,
				healCallout,
			);
			// Node transforms do not run on the document imported when the
			// editor is created, so heal every existing callout once that
			// import has settled.
			queueMicrotask(() => {
				editor.update(
					() => {
						for (const callout of $nodesOfType(CalloutNode)) {
							healCallout(callout);
						}
					},
					{ tag: "history-merge" },
				);
			});
			return dispose;
		});
		realm.pub(createRootEditorSubscription$, (editor) =>
			editor.registerCommand(
				KEY_BACKSPACE_COMMAND,
				handleCalloutBackspace,
				COMMAND_PRIORITY_HIGH,
			),
		);
	},
});

// --------------------------------------------------------------------------
// Toolbar button
// --------------------------------------------------------------------------

/** A toolbar button (with a type dropdown) that inserts a new callout. */
export function InsertCallout() {
	const editor = useCellValue(rootEditor$);
	const items = CALLOUT_TYPES.map((type) => ({
		value: type,
		label: (
			<span className="callout-menu-item">
				<LucideIcon
					className="callout-menu-icon"
					name={iconFor(type)}
				/>
				{defaultTitle(type)}
			</span>
		),
	}));

	return (
		<ButtonOrDropdownButton
			title="Insert callout"
			items={items}
			onChoose={(type) => {
				editor?.update(() => {
					const node = $createCalloutNode(type || "note");
					node.append($createCalloutTitleNode());
					const paragraph = $createParagraphNode();
					node.append(paragraph);
					$insertNodeToNearestRoot(node);
					paragraph.select();
				});
			}}
		>
			<LucideIcon className="callout-toolbar-icon" name="quote" />
		</ButtonOrDropdownButton>
	);
}
