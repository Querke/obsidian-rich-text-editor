// wikilinkButton.tsx
//
// Toolbar button that inserts an Obsidian-style internal link [[Note]].
// Opens a vault-file picker (provided by RichTextOverlay via the
// `onPickInternalLink` callback) and inserts the chosen note's basename as a
// Lexical LinkNode whose href is the URI-encoded name. On save,
// `RichTextOverlay.mdxToObsidian` converts that link back to `[[Note]]`.

import { ButtonWithTooltip, rootEditor$ } from "@mdxeditor/editor";
import { useCellValue } from "@mdxeditor/gurx";
import { $createLinkNode } from "@lexical/link";
import {
	$createParagraphNode,
	$createTextNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
} from "lexical";
import type { NodeKey } from "lexical";
import { LucideIcon } from "./footnotePlugin";

interface SavedPoint {
	key: NodeKey;
	offset: number;
	type: "text" | "element";
}

export interface InsertWikilinkProps {
	onPickInternalLink: () => Promise<string | null>;
}

/** Splice `linkNode` followed by `space` into the document at the caret
 *  position captured before the picker opened. Returns true if the insert
 *  succeeded — the caller is responsible for the end-of-doc fallback. */
function insertAtSavedPoint(
	anchor: SavedPoint | null,
	linkNode: ReturnType<typeof $createLinkNode>,
	space: ReturnType<typeof $createTextNode>,
): boolean {
	if (!anchor) return false;

	const target = $getNodeByKey(anchor.key);
	if (!target) return false;

	if (anchor.type === "text" && $isTextNode(target)) {
		const length = target.getTextContentSize();
		const offset = Math.max(0, Math.min(anchor.offset, length));
		if (offset === 0) {
			target.insertBefore(linkNode);
		} else if (offset >= length) {
			target.insertAfter(linkNode);
		} else {
			const parts = target.splitText(offset);
			parts[0].insertAfter(linkNode);
		}
		linkNode.insertAfter(space);
		return true;
	}

	if (anchor.type === "element" && $isElementNode(target)) {
		const children = target.getChildren();
		const child = children[anchor.offset];
		if (child) {
			child.insertBefore(linkNode);
		} else {
			target.append(linkNode);
		}
		linkNode.insertAfter(space);
		return true;
	}

	return false;
}

export function InsertWikilink(props: InsertWikilinkProps) {
	const editor = useCellValue(rootEditor$);

	const handleClick = async (event: React.MouseEvent) => {
		event.preventDefault();
		if (!editor) return;

		// Snapshot the caret before opening the picker — the modal steals
		// focus and Lexical's selection is cleared by the time the user
		// makes a choice. We capture both endpoints so we can drop the link
		// exactly where the caret was, instead of restoring a selection
		// (which has been unreliable across reconciliations).
		let anchor: SavedPoint | null = null;
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				anchor = {
					key: selection.anchor.key,
					offset: selection.anchor.offset,
					type: selection.anchor.type,
				};
			}
		});

		const name = await props.onPickInternalLink();
		if (!name) return;

		editor.update(() => {
			const href = encodeURI(name);
			const linkNode = $createLinkNode(href);
			linkNode.append($createTextNode(name));
			const trailingSpace = $createTextNode(" ");

			const inserted = insertAtSavedPoint(
				anchor,
				linkNode,
				trailingSpace,
			);
			if (inserted) {
				trailingSpace.selectEnd();
				return;
			}

			// Fallback: append at the end of the document so the link isn't
			// lost if the snapshotted node was removed under us.
			const root = $getRoot();
			const paragraph = $createParagraphNode();
			paragraph.append(linkNode, trailingSpace);
			root.append(paragraph);
			trailingSpace.selectEnd();
		});
	};

	return (
		<ButtonWithTooltip
			title="Insert internal link"
			onClick={(e: React.MouseEvent) => {
				void handleClick(e);
			}}
		>
			<LucideIcon name="sticky-note" />
		</ButtonWithTooltip>
	);
}
