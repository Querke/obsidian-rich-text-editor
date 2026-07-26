// Typing shortcuts that turn a marker paragraph into a block node: ```lang for
// a code block, --- / *** / ___ for a horizontal rule.
//
// MDXEditor's markdownShortcutPlugin can't cover these. It reads activePlugins$
// once at init, so it only picks up the code-block transformer if codeBlockPlugin
// was registered before it — ours isn't. And its element transformers only fire
// on a typed space, so `---` + Enter (what Obsidian does) never converts.

import { createRootEditorSubscription$, realmPlugin } from "@mdxeditor/editor";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import {
	$createParagraphNode,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	INSERT_PARAGRAPH_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_SPACE_COMMAND,
	type LexicalNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";

// `select` is called after insertion when the node has one — MDXEditor's code
// block uses it to focus its CodeMirror instance.
type BlockNode = LexicalNode & { select?: () => void };

interface BlockShortcutPluginParams {
	createCodeBlock: (language: string) => BlockNode;
}

// The paragraph the caret sits at the end of, when its only content is the
// marker text — otherwise null.
function $markerParagraph() {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

	const anchor = selection.anchor;
	const node = anchor.getNode();
	const parent = node.getParent();
	if (
		!$isTextNode(node) ||
		!$isParagraphNode(parent) ||
		parent.getChildrenSize() !== 1 ||
		anchor.offset !== node.getTextContentSize()
	) {
		return null;
	}
	return parent;
}

export function $convertFence(
	createCodeBlock: (language: string) => BlockNode,
): boolean {
	const paragraph = $markerParagraph();
	if (!paragraph) return false;

	const match = paragraph.getTextContent().match(/^```([\w#+.-]*)$/);
	if (!match) return false;

	const codeBlock = createCodeBlock(match[1]);
	// Move the caret off the paragraph BEFORE removing it — a selection left
	// pointing at a detached node throws on the next reconcile (Lexical #20).
	paragraph.selectPrevious();
	paragraph.replace(codeBlock);
	// Deferred so the decorator has mounted its editor by the time it's focused.
	window.setTimeout(() => codeBlock.select?.(), 80);
	return true;
}

// iOS/macOS smart punctuation folds "--" into an en/em dash before the third
// hyphen lands, so three taps of the key arrive as "—-". Count a folded dash as
// the two hyphens it replaced.
const DASH_WEIGHT: Record<string, number> = { "-": 1, "–": 2, "—": 2 };

function isThematicBreak(text: string): boolean {
	if (/^\*{3,}$/.test(text) || /^_{3,}$/.test(text)) return true;
	if (!/^[-–—]+$/.test(text)) return false;
	return [...text].reduce((total, ch) => total + DASH_WEIGHT[ch], 0) >= 3;
}

export function $convertThematicBreak(): boolean {
	const paragraph = $markerParagraph();
	if (!paragraph || !isThematicBreak(paragraph.getTextContent())) {
		return false;
	}

	// Enter would have opened a new line, so land the caret on one below the
	// rule — that also keeps the selection off the paragraph being removed.
	const line = $createHorizontalRuleNode();
	paragraph.replace(line);
	const next = line.getNextSibling();
	if ($isParagraphNode(next) && next.getTextContentSize() === 0) {
		next.select();
	} else {
		const trailing = $createParagraphNode();
		line.insertAfter(trailing);
		trailing.select();
	}
	return true;
}

export const blockShortcutPlugin = realmPlugin<BlockShortcutPluginParams>({
	init(realm, params) {
		if (!params) return;
		const createCodeBlock = params.createCodeBlock;
		const convert = () =>
			$convertFence(createCodeBlock) || $convertThematicBreak();

		realm.pub(createRootEditorSubscription$, (editor) =>
			mergeRegister(
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						if (!convert()) return false;
						event?.preventDefault();
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				// Soft keyboards (iOS) commit a newline through beforeinput
				// rather than keydown, so KEY_ENTER_COMMAND never fires there.
				editor.registerCommand(
					INSERT_PARAGRAPH_COMMAND,
					convert,
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_SPACE_COMMAND,
					(event) => {
						if (!$convertFence(createCodeBlock)) return false;
						event?.preventDefault();
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
			),
		);
	},
});
