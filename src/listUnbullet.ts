// Lexical's built-in REMOVE_LIST_COMMAND handler (`$removeList`) converts the
// whole top-level list to paragraphs, no matter how little is selected — so
// unbulleting one line strips the bullet from every item. This override converts
// only the list items the selection actually covers, leaving every other item
// (and its nesting) bulleted.

import {
	createRootEditorSubscription$,
	realmPlugin,
} from "@mdxeditor/editor";
import {
	$createParagraphNode,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	type LexicalNode,
} from "lexical";
import {
	$createListNode,
	$isListItemNode,
	$isListNode,
	ListItemNode,
	ListNode,
	REMOVE_LIST_COMMAND,
} from "@lexical/list";

// A "content" list item holds inline content; a "wrapper" item holds only a
// nested list (that's how Lexical models indentation). Only content items are
// unbulleted.
function isContentListItem(node: ListItemNode): boolean {
	const first = node.getFirstChild();
	return !(node.getChildrenSize() === 1 && $isListNode(first));
}

function topListOf(list: ListNode): ListNode {
	let top = list;
	let ancestor: LexicalNode | null = top.getParent();
	while (ancestor && ($isListNode(ancestor) || $isListItemNode(ancestor))) {
		if ($isListNode(ancestor)) top = ancestor;
		ancestor = ancestor.getParent();
	}
	return top;
}

// Lexical drops an element that can't be empty the moment its last child goes,
// so the nodes handed here may already be detached — hence the isAttached check
// rather than assuming we still own the chain.
function pruneEmptyLists(node: LexicalNode | null): void {
	let current = node;
	while (
		current &&
		current.isAttached() &&
		($isListNode(current) || $isListItemNode(current)) &&
		current.getChildrenSize() === 0
	) {
		const parent: LexicalNode | null = current.getParent();
		current.remove();
		current = parent;
	}
}

function $collectSelectedContentItems(
	nodes: LexicalNode[],
): ListItemNode[] {
	const found = new Map<string, ListItemNode>();
	for (const node of nodes) {
		let current: LexicalNode | null = node;
		while (current) {
			if ($isListItemNode(current)) {
				if (isContentListItem(current)) {
					found.set(current.getKey(), current);
				}
				break;
			}
			current = current.getParent();
		}
	}
	return [...found.values()];
}

// `cursors` tracks, per top-level list, where the next lifted nested paragraph
// goes, so multiple lifted items keep their order.
function $unbulletItem(
	li: ListItemNode,
	cursors: Map<string, LexicalNode>,
): void {
	const list = li.getParent();
	if (!$isListNode(list)) return;

	const paragraph = $createParagraphNode();
	li.getChildren().forEach((child) => paragraph.append(child));

	// Splice the paragraph in *before* detaching the item: removing the last
	// item takes the list with it, and inserting relative to a detached node
	// throws.
	const outer = list.getParent();
	if ($isListNode(outer) || $isListItemNode(outer)) {
		const top = topListOf(list);
		const cursor = cursors.get(top.getKey()) ?? top;
		cursor.insertAfter(paragraph);
		cursors.set(top.getKey(), paragraph);
		li.remove();
		pruneEmptyLists(list);
		pruneEmptyLists(outer);
		return;
	}

	const after = li.getNextSiblings();
	list.insertAfter(paragraph);
	li.remove();
	if (after.length > 0) {
		const trailing = $createListNode(list.getListType(), list.getStart());
		after.forEach((node) => trailing.append(node));
		paragraph.insertAfter(trailing);
	}
	pruneEmptyLists(list);
}

export const listUnbulletPlugin = realmPlugin({
	init(realm) {
		realm.pub(createRootEditorSubscription$, (editor) =>
			editor.registerCommand(
				REMOVE_LIST_COMMAND,
				() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return false;
					const items = $collectSelectedContentItems(
						selection.getNodes(),
					);
					if (items.length === 0) return false;
					const cursors = new Map<string, LexicalNode>();
					for (const li of items) {
						// An earlier item may have collapsed this one's list.
						if (li.isAttached()) $unbulletItem(li, cursors);
					}
					return true;
				},
				COMMAND_PRIORITY_CRITICAL,
			),
		);
	},
});
