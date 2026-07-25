import {
	$createCodeBlockNode,
	createRootEditorSubscription$,
	realmPlugin,
} from "@mdxeditor/editor";
import {
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	KEY_SPACE_COMMAND,
} from "lexical";
import { mergeRegister } from "@lexical/utils";

interface CodeBlockShortcutPluginParams {
	resolveLanguage: (language: string) => string | null;
}

export const codeBlockShortcutPlugin =
	realmPlugin<CodeBlockShortcutPluginParams>({
		init(realm, params) {
			if (!params) return;
			realm.pub(createRootEditorSubscription$, (editor) => {
				const convertFence = (event: KeyboardEvent | null) => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
						return false;
					}

					const anchor = selection.anchor;
					const node = anchor.getNode();
					const parent = node.getParent();
					if (
						!$isTextNode(node) ||
						!$isParagraphNode(parent) ||
						parent.getChildrenSize() !== 1 ||
						anchor.offset !== node.getTextContentSize()
					) {
						return false;
					}

					const match = node.getTextContent().match(/^```([\w#+-]+)?$/);
					if (!match) return false;
					const language = params.resolveLanguage(match[1] ?? "");
					if (language === null) return false;

					event?.preventDefault();
					const codeBlock = $createCodeBlockNode({
						code: "",
						language,
						meta: "",
					});
					parent.replace(codeBlock);
					codeBlock.select();
					return true;
				};

				return mergeRegister(
					editor.registerCommand(
						KEY_ENTER_COMMAND,
						convertFence,
						COMMAND_PRIORITY_HIGH,
					),
					editor.registerCommand(
						KEY_SPACE_COMMAND,
						convertFence,
						COMMAND_PRIORITY_HIGH,
					),
				);
			});
		},
	});
