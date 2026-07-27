// Lexical's built-in REMOVE_LIST_COMMAND handler (`$removeList`) converts the
// whole top-level list to paragraphs, no matter how little is selected — so
// unbulleting one line strips the bullet from every item. This override converts
// only the list items the selection actually covers, leaving every other item
// (and its nesting) bulleted, and drops the resulting paragraph where the item
// was: the list is split around it instead of the paragraph being appended after
// the list.

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
	$createListItemNode,
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

function $unbulletItem(li: ListItemNode): void {
	const list = li.getParent();
	if (!$isListNode(list)) return;

	// A content item can still own a nested list (the items indented under it);
	// that sublist must stay a list, so it seeds the trailing structure instead
	// of being folded into the paragraph.
	const paragraph = $createParagraphNode();
	let carry: ListNode | null = null;
	for (const child of li.getChildren()) {
		if ($isListNode(child)) {
			carry = child;
		} else {
			paragraph.append(child);
		}
	}

	// Walk from the item up to the top-level list, rebuilding everything that
	// comes *after* it at each level into `carry` — the list that goes below the
	// paragraph. What stays behind is everything before it.
	const top = topListOf(list);
	let node: LexicalNode = li;
	let level: ListNode = list;
	for (;;) {
		const after = node.getNextSiblings();
		if (carry || after.length > 0) {
			const trailing = $createListNode(
				level.getListType(),
				level.getStart(),
			);
			if (carry) {
				const wrapper = $createListItemNode();
				wrapper.append(carry);
				trailing.append(wrapper);
			}
			after.forEach((sibling) => trailing.append(sibling));
			carry = trailing;
		}
		if (level === top) break;
		const wrapperItem = level.getParent();
		if (!$isListItemNode(wrapperItem)) break;
		const parentList = wrapperItem.getParent();
		if (!$isListNode(parentList)) break;
		node = wrapperItem;
		level = parentList;
	}

	// Splice the paragraph in *before* detaching the item: removing the last
	// item takes the list with it, and inserting relative to a detached node
	// throws.
	top.insertAfter(paragraph);
	if (carry) paragraph.insertAfter(carry);
	li.remove();
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
					for (const li of items) {
						// An earlier item may have collapsed this one's list.
						if (li.isAttached()) $unbulletItem(li);
					}
					return true;
				},
				COMMAND_PRIORITY_CRITICAL,
			),
		);
	},
});
