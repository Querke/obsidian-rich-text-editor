// tagLinkPlugin.ts
import {
	addActivePlugin$,
	createRootEditorSubscription$,
	realmPlugin,
} from "@mdxeditor/editor";

import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	KEY_SPACE_COMMAND,
	LexicalEditor,
	TextNode,
} from "lexical";

import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { $createTextNode } from "lexical";

type TagMatch = {
	startOffset: number;
	tag: string;
	fullText: string;
};

export let lastLexicalEditor: LexicalEditor | null = null;

function tryMatchTag(beforeCaretText: string): TagMatch | null {
	// Match the last token ending at caret: "... #my/tag-1"
	const re = /(^|[\s([{>])#([A-Za-z0-9_/-]+)$/;
	const match = beforeCaretText.match(re);
	if (!match) {
		return null;
	}

	const tag = match[2];
	if (!tag) {
		return null;
	}

	const hashIndex = beforeCaretText.lastIndexOf("#");
	if (hashIndex < 0) {
		return null;
	}

	const fullText = "#" + tag;

	return {
		startOffset: hashIndex,
		tag: tag,
		fullText: fullText,
	};
}

export const tagLinkPlugin = realmPlugin({
	init: (realm) => {
		realm.pub(addActivePlugin$, "tag-link");

		realm.pub(createRootEditorSubscription$, (editor) => {
			lastLexicalEditor = editor;

			return editor.registerCommand(
				KEY_SPACE_COMMAND,
				() => {
					let didConvert = false;

					editor.update(() => {
						const selection = $getSelection();
						if (!$isRangeSelection(selection)) {
							return;
						}

						const anchor = selection.anchor;
						const anchorNode = anchor.getNode();
						if (!(anchorNode instanceof TextNode)) {
							return;
						}

						const parent = anchorNode.getParent();
						if (parent && $isLinkNode(parent)) {
							return;
						}

						const caretOffset = anchor.offset;
						const text = anchorNode.getTextContent();
						const before = text.slice(0, caretOffset);
						const match = tryMatchTag(before);
						if (!match) {
							return;
						}

						// Split out "#tag" into its own TextNode.
						const startOffset = match.startOffset;
						const endOffset = caretOffset;

						const parts = anchorNode.splitText(
							startOffset,
							endOffset,
						);

						console.log("parts", parts);
						if (parts.length < 2) {
							return;
						}

						const tagTextNode = parts[1];
						const url = "tag:" + match.tag;
						console.log("url ", url);
						const linkNode = $createLinkNode(url);
						console.log("linknode", linkNode);
						const linkTextNode = $createTextNode(match.fullText);
						console.log("linknode text", linkTextNode);

						linkNode.append(linkTextNode);
						tagTextNode.replace(linkNode);

						// Insert the space ourselves and stop Lexical default handling
						const spaceNode = $createTextNode(" ");
						linkNode.insertAfter(spaceNode);
						spaceNode.selectEnd();

						didConvert = true;
					});

					return didConvert; // true => we handled space insertion
				},
				COMMAND_PRIORITY_LOW,
			);
		});
	},
});
