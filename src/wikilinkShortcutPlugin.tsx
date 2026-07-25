import {
	addComposerChild$,
	createRootEditorSubscription$,
	realmPlugin,
} from "@mdxeditor/editor";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import {
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	TextNode,
	type NodeKey,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface WikilinkSuggestion {
	link: string;
	label: string;
	detail: string;
}

interface WikilinkShortcutPluginParams {
	getSuggestions: (query: string) => WikilinkSuggestion[];
}

interface ActiveSuggestion {
	nodeKey: NodeKey;
	startOffset: number;
	endOffset: number;
	query: string;
	items: WikilinkSuggestion[];
	left: number;
	top: number;
}

function replaceTextRangeWithLink(
	node: TextNode,
	startOffset: number,
	endOffset: number,
	link: string,
	label: string,
	selectAfter: boolean,
) {
	let target = node;
	if (startOffset > 0) {
		const parts = target.splitText(startOffset);
		target = parts[1];
	}
	const matchLength = endOffset - startOffset;
	if (matchLength < target.getTextContentSize()) {
		target = target.splitText(matchLength)[0];
	}

	const linkNode = $createLinkNode(encodeURI(link));
	linkNode.append($createTextNode(label));
	target.replace(linkNode);
	if (selectAfter) linkNode.selectNext();
}

function WikilinkSuggestions(props: WikilinkShortcutPluginParams) {
	const [editor] = useLexicalComposerContext();
	const [active, setActive] = useState<ActiveSuggestion | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const activeRef = useRef<ActiveSuggestion | null>(null);
	const selectedIndexRef = useRef(0);

	useEffect(() => {
		activeRef.current = active;
	}, [active]);
	useEffect(() => {
		selectedIndexRef.current = selectedIndex;
	}, [selectedIndex]);

	const choose = (item: WikilinkSuggestion) => {
		const match = activeRef.current;
		if (!match) return;

		editor.update(() => {
			const node = $getNodeByKey(match.nodeKey);
			if (!$isTextNode(node)) return;
			const typedText = node
				.getTextContent()
				.slice(match.startOffset, match.endOffset);
			if (typedText !== `[[${match.query}`) return;

			replaceTextRangeWithLink(
				node,
				match.startOffset,
				match.endOffset,
				item.link,
				item.label,
				true,
			);
		});
		setActive(null);
	};
	const chooseRef = useRef(choose);
	chooseRef.current = choose;

	useEffect(() => {
		let frame = 0;
		const unregister = editor.registerUpdateListener(({ editorState }) => {
			let next:
				| Omit<ActiveSuggestion, "items" | "left" | "top">
				| null = null;
			editorState.read(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
					return;
				}
				const anchor = selection.anchor;
				const node = anchor.getNode();
				if (
					!$isTextNode(node) ||
					node.hasFormat("code") ||
					$isLinkNode(node.getParent())
				) {
					return;
				}

				const beforeCaret = node
					.getTextContent()
					.slice(0, anchor.offset);
				const match = beforeCaret.match(/\[\[([^[\]\n|]*)$/);
				if (!match) return;
				next = {
					nodeKey: node.getKey(),
					startOffset: anchor.offset - match[0].length,
					endOffset: anchor.offset,
					query: match[1],
				};
			});

			const ownerWindow =
				editor.getRootElement()?.ownerDocument.defaultView ?? window;
			ownerWindow.cancelAnimationFrame(frame);
			frame = ownerWindow.requestAnimationFrame(() => {
				if (!next) {
					setActive(null);
					return;
				}

				const items = props.getSuggestions(next.query).slice(0, 8);
				if (items.length === 0) {
					setActive(null);
					return;
				}

				const domSelection = ownerWindow.getSelection();
				const range = domSelection?.rangeCount
					? domSelection.getRangeAt(0).cloneRange()
					: null;
				range?.collapse(false);
				let rect = range?.getBoundingClientRect();
				if (!rect || (rect.width === 0 && rect.height === 0)) {
					rect = editor
						.getElementByKey(next.nodeKey)
						?.getBoundingClientRect();
				}
				if (!rect) {
					setActive(null);
					return;
				}

				setSelectedIndex(0);
				setActive({
					...next,
					items,
					left: Math.max(
						8,
						Math.min(rect.left, ownerWindow.innerWidth - 328),
					),
					top: Math.max(
						8,
						Math.min(rect.bottom + 4, ownerWindow.innerHeight - 260),
					),
				});
			});
		});

		return () => {
			unregister();
			const ownerWindow =
				editor.getRootElement()?.ownerDocument.defaultView ?? window;
			ownerWindow.cancelAnimationFrame(frame);
		};
	}, [editor, props.getSuggestions]);

	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					KEY_ARROW_DOWN_COMMAND,
					(event) => {
						const match = activeRef.current;
						if (!match) return false;
						event?.preventDefault();
						setSelectedIndex((current) =>
							(current + 1) % match.items.length,
						);
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_ARROW_UP_COMMAND,
					(event) => {
						const match = activeRef.current;
						if (!match) return false;
						event?.preventDefault();
						setSelectedIndex((current) =>
							(current - 1 + match.items.length) %
							match.items.length,
						);
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						const match = activeRef.current;
						if (!match) return false;
						event?.preventDefault();
						const item = match.items[selectedIndexRef.current];
						if (item) queueMicrotask(() => chooseRef.current(item));
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_TAB_COMMAND,
					(event) => {
						const match = activeRef.current;
						if (!match) return false;
						event?.preventDefault();
						const item = match.items[selectedIndexRef.current];
						if (item) queueMicrotask(() => chooseRef.current(item));
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_ESCAPE_COMMAND,
					(event) => {
						if (!activeRef.current) return false;
						event?.preventDefault();
						setActive(null);
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
			),
		[editor],
	);

	if (!active) return null;
	const portalTarget =
		editor.getRootElement()?.ownerDocument.body ?? activeDocument.body;
	return createPortal(
		<div
			className="rich-text-wikilink-suggestions"
			role="listbox"
			style={{ left: active.left, top: active.top }}
		>
			{active.items.map((item, index) => (
				<button
					key={item.link}
					type="button"
					className={index === selectedIndex ? "is-selected" : ""}
					role="option"
					aria-selected={index === selectedIndex}
					onMouseDown={(event) => event.preventDefault()}
					onMouseEnter={() => setSelectedIndex(index)}
					onClick={() => choose(item)}
				>
					<span>{item.label}</span>
					<small>{item.detail}</small>
				</button>
			))}
		</div>,
		portalTarget,
	);
}

export const wikilinkShortcutPlugin =
	realmPlugin<WikilinkShortcutPluginParams>({
		init(realm, params) {
			if (!params) return;
			realm.pub(
				addComposerChild$,
				() => <WikilinkSuggestions getSuggestions={params.getSuggestions} />,
			);
			realm.pub(createRootEditorSubscription$, (editor) =>
				editor.registerNodeTransform(TextNode, (node) => {
					if (node.hasFormat("code") || $isLinkNode(node.getParent())) {
						return;
					}
					const match = node
						.getTextContent()
						.match(/\[\[([^[\]\n|]+)(?:\|([^\]\n]+))?\]\]/);
					if (!match || match.index === undefined) return;

					const selection = $getSelection();
					const endOffset = match.index + match[0].length;
					const selectAfter =
						$isRangeSelection(selection) &&
						selection.isCollapsed() &&
						selection.anchor.key === node.getKey() &&
						selection.anchor.offset === endOffset;
					replaceTextRangeWithLink(
						node,
						match.index,
						endOffset,
						match[1].trim(),
						(match[2] ?? match[1]).trim(),
						selectAfter,
					);
				}),
			);
		},
	});
