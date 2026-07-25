// The link dialog, rendered as a docked bar (see editorDock.tsx) instead of
// MDXEditor's floating Radix popover — which anchors to the selected text and so
// ends up under the on-screen keyboard on mobile.
//
// All the state and mutation logic still comes from MDXEditor's linkDialogPlugin
// (`linkDialogState$` + its actions); only the UI is ours. Its own popover is
// disabled by handing `linkDialogPlugin` an empty LinkDialog component.
//
// Two states: a preview of the link under the caret (go to / edit / copy /
// remove) and an edit form (URL + anchor text). The link's `title` is carried
// through the edit form untouched — we don't surface it as a field, but dropping
// it from the update payload would wipe it.

import {
	activeEditor$,
	addTopAreaChild$,
	cancelLinkEdit$,
	createActiveEditorSubscription$,
	linkDialogState$,
	realmPlugin,
	removeLink$,
	switchFromPreviewToLinkEdit$,
	updateLink$,
} from "@mdxeditor/editor";
import { Cell, useCellValues, usePublisher } from "@mdxeditor/gurx";
import { $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import {
	$getNodeByKey,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import { DockedBar } from "./editorDock";
import { LucideIcon } from "./footnotePlugin";

export type OpenLinkHandler = (
	anchor: HTMLAnchorElement,
	where: "current" | "tab",
) => void;

const openLink$ = Cell<OpenLinkHandler | null>(null);

// The link the caret sits immediately before or after, if any.
//
// MDXEditor only considers a link "selected" when the caret resolves *inside*
// the link's own text node. Which node a caret on the boundary lands in is up to
// Lexical and the browser: when the link is the last thing in its paragraph
// there is nowhere else for the caret to go, so it works — but as soon as the
// link is followed (or preceded) by other text or whitespace, the caret is
// attributed to that sibling and the dialog never opens. This covers those
// positions.
function $linkNextToCaret(): LinkNode | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
	const anchor = selection.anchor;
	const node = anchor.getNode();

	if ($isTextNode(node)) {
		// Already inside a link — the case MDXEditor handles by itself.
		if ($isLinkNode(node.getParent())) return null;
		const before = anchor.offset === 0 ? node.getPreviousSibling() : null;
		if ($isLinkNode(before)) return before;
		const after =
			anchor.offset === node.getTextContentSize()
				? node.getNextSibling()
				: null;
		return $isLinkNode(after) ? after : null;
	}

	// An element-anchored caret addresses a child index rather than an offset.
	if ($isElementNode(node)) {
		const children = node.getChildren();
		const before = children[anchor.offset - 1];
		if ($isLinkNode(before)) return before;
		const after = children[anchor.offset];
		return $isLinkNode(after) ? after : null;
	}

	return null;
}

function LinkEditFields(props: {
	url: string;
	text: string;
	withAnchorText: boolean;
	onSave: (url: string, text: string) => void;
	onCancel: () => void;
}) {
	const [url, setUrl] = useState(props.url);
	const [text, setText] = useState(props.text);
	const urlRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		urlRef.current?.focus();
		urlRef.current?.select();
	}, []);

	return (
		<form
			className="rich-text-docked-fields"
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				props.onSave(url, text);
			}}
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				e.preventDefault();
				e.stopPropagation();
				props.onCancel();
			}}
		>
			<input
				ref={urlRef}
				className="rich-text-docked-input"
				type="text"
				placeholder="URL"
				value={url}
				onChange={(e) => setUrl(e.target.value)}
			/>
			<div className="rich-text-docked-actions">
				<button type="submit" className="rich-text-docked-btn mod-cta">
					Save
				</button>
				<button
					type="button"
					className="rich-text-docked-btn"
					onClick={props.onCancel}
				>
					Cancel
				</button>
			</div>
			{props.withAnchorText && (
				<input
					className="rich-text-docked-input"
					type="text"
					placeholder="Anchor text"
					value={text}
					onChange={(e) => setText(e.target.value)}
				/>
			)}
		</form>
	);
}

function LinkDialogBar() {
	const [state, activeEditor, openLink] = useCellValues(
		linkDialogState$,
		activeEditor$,
		openLink$,
	);
	const setState = usePublisher(linkDialogState$);
	const updateLink = usePublisher(updateLink$);
	const cancelLinkEdit = usePublisher(cancelLinkEdit$);
	const switchToEdit = usePublisher(switchFromPreviewToLinkEdit$);
	const removeLink = usePublisher(removeLink$);
	const [copied, setCopied] = useState(false);

	if (state.type === "inactive") return null;

	if (state.type === "edit") {
		return (
			<DockedBar className="rich-text-link-bar">
				<LucideIcon className="rich-text-docked-icon" name="link" />
				<LinkEditFields
					key={state.linkNodeKey}
					url={state.url}
					text={state.text}
					withAnchorText={state.withAnchorText}
					onSave={(url, text) =>
						updateLink({ url, text, title: state.title })
					}
					onCancel={() => cancelLinkEdit()}
				/>
			</DockedBar>
		);
	}

	// The bar also opens for a caret that merely sits next to a link (see
	// `$linkNextToCaret`), where the Lexical selection is outside the link node —
	// but MDXEditor's edit and remove actions both operate on that selection.
	// Pull it into the link first: collapsed at the link's end for editing (so
	// `updateLink$` takes its single-link-node path and rewrites the anchor text
	// too), spanning the link's children for removal (so `extract()` hands
	// Lexical the children whose parent is the link). `discrete` commits the
	// update synchronously, so `currentSelection$` is current by the time the
	// action runs.
	const selectLink = (collapsed: boolean) => {
		activeEditor?.update(
			() => {
				const node = $getNodeByKey(state.linkNodeKey);
				if (!$isLinkNode(node)) return;
				const last = node.getLastDescendant();
				if (collapsed && $isTextNode(last)) {
					const end = last.getTextContentSize();
					last.select(end, end);
				} else {
					node.select(0, node.getChildrenSize());
				}
			},
			{ discrete: true },
		);
	};

	// Open through the rendered <a> rather than the raw URL, so internal,
	// external and tag links route exactly as they do when the anchor itself is
	// clicked in the document (the host resolves them off href + link text).
	const goTo = (where: "current" | "tab") => {
		const anchor = activeEditor?.getElementByKey(state.linkNodeKey);
		if (anchor instanceof HTMLAnchorElement) openLink?.(anchor, where);
	};

	const copy = () => {
		void navigator.clipboard.writeText(state.url).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1000);
		});
	};

	return (
		<DockedBar className="rich-text-link-bar">
			<LucideIcon className="rich-text-docked-icon" name="link" />
			<div className="rich-text-docked-fields">
				<span className="rich-text-link-url" title={state.url}>
					{state.url}
				</span>
				<div className="rich-text-docked-actions">
					{/* preventDefault on mousedown keeps focus (and so the
					    Lexical selection these actions operate on) in the
					    document instead of moving it into the bar. */}
					<button
						className="clickable-icon"
						aria-label="Go to link"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => goTo("current")}
						onAuxClick={(e) => {
							if (e.button === 1) goTo("tab");
						}}
					>
						<LucideIcon name="arrow-up-right" />
					</button>
					<button
						className="clickable-icon"
						aria-label="Edit link"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							selectLink(true);
							switchToEdit();
						}}
					>
						<LucideIcon name="pencil" />
					</button>
					<button
						className="clickable-icon"
						aria-label="Copy link"
						onMouseDown={(e) => e.preventDefault()}
						onClick={copy}
					>
						<LucideIcon name={copied ? "check" : "copy"} />
					</button>
					<button
						className="clickable-icon"
						aria-label="Remove link"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							selectLink(false);
							removeLink();
						}}
					>
						<LucideIcon name="unlink" />
					</button>
					<button
						className="clickable-icon"
						aria-label="Close"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => setState({ type: "inactive" })}
					>
						<LucideIcon name="x" />
					</button>
				</div>
			</div>
		</DockedBar>
	);
}

export const linkDialogBarPlugin = realmPlugin<{
	onOpenLink: OpenLinkHandler;
}>({
	init(realm, params) {
		realm.pub(addTopAreaChild$, LinkDialogBar);
		if (params) realm.pub(openLink$, params.onOpenLink);

		// Widen MDXEditor's detection to carets sitting next to a link.
		//
		// Reads the state handed to the update listener rather than
		// `editor.getEditorState()`: a caret move is dispatched from inside the
		// update that commits it, so the editor's current state still describes
		// the *previous* caret position and detection would run a step behind.
		// Node fields have to be pulled out inside the callback too — node
		// methods throw once the read has returned.
		//
		// Only the publish is deferred, so it lands after MDXEditor's own
		// derivation off `currentSelection$` has settled and just fills in the
		// gaps where that came up empty. Keying this off editor updates rather
		// than off `linkDialogState$` is what lets Escape and Close stick:
		// neither moves the caret, so neither reopens the bar.
		realm.pub(createActiveEditorSubscription$, (editor) =>
			editor.registerUpdateListener(({ editorState }) => {
				const preview = editorState.read(() => {
					const link = $linkNextToCaret();
					if (!link) return null;
					return {
						type: "preview" as const,
						url: link.getURL(),
						title: link.getTitle() ?? "",
						linkNodeKey: link.getKey(),
						rectangle: { top: 0, left: 0, width: 0, height: 0 },
					};
				});
				if (!preview) return;
				queueMicrotask(() => {
					if (realm.getValue(linkDialogState$).type !== "inactive") {
						return;
					}
					realm.pub(linkDialogState$, preview);
				});
			}),
		);
	},
	// The host re-creates its callbacks on every render, so refresh the handler
	// instead of holding on to the one captured at init.
	update(realm, params) {
		if (params) realm.pub(openLink$, params.onOpenLink);
	},
});
