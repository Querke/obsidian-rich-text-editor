// ReactView.tsx
import { oneDark } from "@codemirror/theme-one-dark";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	codeBlockPlugin,
	codeMirrorPlugin,
	CodeToggle,
	CreateLink,
	directivesPlugin,
	headingsPlugin,
	HighlightToggle,
	imagePlugin,
	InsertCodeBlock,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	ListsToggle,
	markdownShortcutPlugin,
	MDXEditor,
	MDXEditorMethods,
	quotePlugin,
	StrikeThroughSupSubToggles,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from "@mdxeditor/editor";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { $getNearestNodeFromDOMNode } from "lexical";
import type { LexicalEditor } from "lexical";
import { $isListItemNode } from "@lexical/list";
import { IndentControls } from "./IndentControls";
import { tagLinkPlugin } from "./tagLinkPlugin";
import { calloutPlugin, InsertCallout } from "./calloutPlugin";
import { footnotePlugin, InsertFootnote } from "./footnotePlugin";
import { autoLinkTitlePlugin } from "./autoLinkTitlePlugin";
import { PropertiesDisplay, PropertyInfo } from "./PropertiesDisplay";
import { InsertWikilink } from "./wikilinkButton";
import {
	EmbedRenderer,
	obsidianEmbedPlugin,
	setEditorEmbedRenderer,
} from "./obsidianEmbedPlugin";

// Languages offered in the code-block language dropdown. Keyed by the fenced
// code-block id; the value is the human-readable label shown in the dropdown.
const CODE_BLOCK_LANGUAGES: Record<string, string> = {
	jsx: "JavaScript (react)",
	js: "JavaScript",
	css: "CSS",
	tsx: "TypeScript (react)",
	ts: "TypeScript",
	md: "Markdown",
	html: "HTML",
	cs: "C#",
	c: "C",
	cpp: "C++",
	java: "Java",
	py: "Python",
	go: "Go",
	rust: "Rust",
	kotlin: "Kotlin",
	dart: "Dart",
	ruby: "Ruby",
	php: "PHP",
	sql: "SQL",
	svelte: "Svelte",
	lua: "Lua",
};

// Reverse lookup (display label -> code-block id) used to render the flair.
const CODE_BLOCK_LABEL_TO_ID = new Map(
	Object.entries(CODE_BLOCK_LANGUAGES).map(([id, label]) => [label, id]),
);

interface Props {
	title: string;
	text: string;
	properties: PropertyInfo[];
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => Promise<boolean>;
	onImageUpload: (image: File) => Promise<string>;
	onResolveImage: (src: string) => string;
	onNavigate: (path: string) => void;
	onPickInternalLink: () => Promise<string | null>;
	onRenderEmbed?: EmbedRenderer;
}

export interface RichTextEditorRef {
	setTitle: (title: string) => void;
	setMarkdown: (markdown: string) => void;
	setProperties: (properties: PropertyInfo[]) => void;
}

type LexicalContentEditable = HTMLElement & {
	__lexicalEditor?: LexicalEditor;
};

export const RichTextEditor = forwardRef<RichTextEditorRef, Props>(
	(props, ref) => {
		const editorRef = useRef<MDXEditorMethods>(null);
		const hostRef = useRef<HTMLDivElement | null>(null);

		const [internalTitle, setInternalTitle] = useState(props.title);
		const [properties, setProperties] = useState<PropertyInfo[]>(
			props.properties,
		);

		const [propertiesContainer, setPropertiesContainer] =
			useState<HTMLElement | null>(null);
		const [titleBarContainer, setTitleBarContainer] =
			useState<HTMLElement | null>(null);

		const isDark = activeDocument.body.classList.contains("theme-dark");

		useImperativeHandle(ref, () => ({
			setTitle: (newTitle: string) => {
				setInternalTitle(newTitle);
			},
			setMarkdown: (markdown: string) => {
				editorRef.current?.setMarkdown(markdown);
			},
			setProperties: (props: PropertyInfo[]) => {
				setProperties(props);
			},
		}));

		useEffect(() => {
			if (!hostRef.current) return;

			// Wait for MDXEditor to render
			window.setTimeout(() => {
				const root =
					hostRef.current?.querySelector<HTMLElement>(".mdxeditor");

				// Get the container
				const contentEditor = root?.querySelector(
					".mdxeditor-root-contenteditable",
				);
				// Get the specific first child element
				const targetChild = contentEditor?.firstElementChild;

				if (root && targetChild) {
					let bar =
						root.querySelector<HTMLElement>(".custom-titlebar");
					if (!bar) {
						bar = createDiv();
						bar.className = "custom-titlebar";
						targetChild.prepend(bar);
					}
					setTitleBarContainer(bar);

					let propsBar =
						root.querySelector<HTMLElement>(".custom-properties");
					if (!propsBar) {
						propsBar = createDiv();
						propsBar.className = "custom-properties";
						bar.after(propsBar);
					}
					setPropertiesContainer(propsBar);
				}
			}, 0);
		}, []);

		// Install the Obsidian render bridge on the Lexical editor instance.
		// Decorator nodes for ```tasks / ```dataview / etc. look it up via the
		// LexicalEditor handed to them by Lexical's reconciler.
		useEffect(() => {
			if (!hostRef.current) return;
			const renderer = props.onRenderEmbed;
			if (!renderer) return;

			let cancelled = false;
			let installedOn: LexicalEditor | null = null;

			const tryInstall = () => {
				if (cancelled) return;
				const editable =
					hostRef.current?.querySelector<LexicalContentEditable>(
						".mxeditor-content-editable",
					);
				const lexicalEditor = editable?.__lexicalEditor ?? null;
				if (!lexicalEditor) {
					window.setTimeout(tryInstall, 50);
					return;
				}
				setEditorEmbedRenderer(lexicalEditor, renderer);
				installedOn = lexicalEditor;
			};
			tryInstall();

			return () => {
				cancelled = true;
				if (installedOn) {
					setEditorEmbedRenderer(installedOn, null);
				}
			};
		}, [props.onRenderEmbed]);

		useEffect(() => {
			if (!hostRef.current) return;

			const enableMobileFeatures = () => {
				const editable = hostRef.current?.querySelector(
					".mxeditor-content-editable",
				);
				if (editable) {
					// Force iOS to Capitalize the first letter of sentences
					editable.setAttribute("autocapitalize", "sentences");
				}
			};

			// Run quickly after mount to override defaults
			window.setTimeout(enableMobileFeatures, 100);
		}, []);

		useEffect(() => {
			if (!hostRef.current) {
				return;
			}

			const host = hostRef.current;
			const editable = host.querySelector<HTMLElement>(
				".mxeditor-content-editable",
			);
			if (!editable) {
				return;
			}

			const checkboxHitWidthPx = 30;
			const isMobileOverlay = !!host.closest(
				".rich-text-overlay.is-mobile",
			);
			const isMobileTouchDevice =
				isMobileOverlay && navigator.maxTouchPoints > 0;

			let keyboardDismissTouchStartX: number | null = null;
			let keyboardDismissTouchStartY: number | null = null;
			let keyboardDismissPreviousY: number | null = null;
			let keyboardDismissStartedAboveToolbar = false;
			let keyboardDismissDidBlur = false;
			type SelectionSnapshot = {
				isCollapsed: boolean;
				anchorNode: Node | null;
				anchorOffset: number;
				focusNode: Node | null;
				focusOffset: number;
			};
			let keyboardDismissInitialSelection: SelectionSnapshot | null = null;
			const snapshotSelection = (): SelectionSnapshot | null => {
				const sel = window.getSelection();
				if (!sel) return null;
				return {
					isCollapsed: sel.isCollapsed,
					anchorNode: sel.anchorNode,
					anchorOffset: sel.anchorOffset,
					focusNode: sel.focusNode,
					focusOffset: sel.focusOffset,
				};
			};
			const selectionsDiffer = (
				a: SelectionSnapshot | null,
				b: SelectionSnapshot | null,
			): boolean => {
				if (!a || !b) return false;
				return (
					a.anchorNode !== b.anchorNode ||
					a.anchorOffset !== b.anchorOffset ||
					a.focusNode !== b.focusNode ||
					a.focusOffset !== b.focusOffset ||
					a.isCollapsed !== b.isCollapsed
				);
			};

			const onPointerDownCapture = (evt: PointerEvent) => {
				const target = evt.target as HTMLElement | null;
				if (!target) {
					return;
				}

				const li = target.closest('li[role="checkbox"]');
				if (!li) {
					return;
				}

				const rect = li.getBoundingClientRect();
				const dir = window.getComputedStyle(li).direction;

				let xFromStart = 0;

				if (dir === "rtl") {
					xFromStart = rect.right - evt.clientX;
				} else {
					xFromStart = evt.clientX - rect.left;
				}

				// Only allow Lexical to toggle when clicking in the checkbox gutter
				if (xFromStart > checkboxHitWidthPx) {
					evt.stopImmediatePropagation();
				}
			};

			// iOS-specific: touchstart fires before the native context menu decision.
			// Calling preventDefault() here blocks the iOS "Paste / Select" menu that
			// appears when the user taps near the caret inside a contenteditable.
			// Because preventDefault() also suppresses the subsequent click event,
			// we stash the li and fire a synthetic click on touchend ourselves.
			let pendingCheckboxLi: Element | null = null;

			const onTouchStartCapture = (evt: Event) => {
				const touchEvt = evt as TouchEvent;
				const touch = touchEvt.touches[0];
				const target = activeDocument.elementFromPoint(
					touch.clientX,
					touch.clientY,
				);
				const li = target?.closest('li[role="checkbox"]');
				if (!li) return;

				const rect = li.getBoundingClientRect();
				const dir = window.getComputedStyle(li).direction;
				const xFromStart =
					dir === "rtl"
						? rect.right - touch.clientX
						: touch.clientX - rect.left;

				if (xFromStart <= checkboxHitWidthPx) {
					evt.preventDefault();
					pendingCheckboxLi = li;
				}
			};

			const onTouchMoveCapture = (evt: Event) => {
				if (
					!isMobileTouchDevice ||
					keyboardDismissTouchStartX === null ||
					keyboardDismissTouchStartY === null ||
					keyboardDismissPreviousY === null ||
					!keyboardDismissStartedAboveToolbar ||
					keyboardDismissDidBlur
				) {
					return;
				}

				const touchEvt = evt as TouchEvent;
				if (touchEvt.touches.length !== 1) {
					keyboardDismissTouchStartX = null;
					keyboardDismissTouchStartY = null;
					keyboardDismissPreviousY = null;
					keyboardDismissStartedAboveToolbar = false;
					keyboardDismissDidBlur = false;
					keyboardDismissInitialSelection = null;
					return;
				}

				const active =
					activeDocument.activeElement as HTMLElement | null;
				const selection = window.getSelection();
				const anchorNode = selection?.anchorNode;
				const anchorElement =
					anchorNode?.nodeType === Node.ELEMENT_NODE
						? (anchorNode as Element)
						: anchorNode?.parentElement;
				const selectionInEditable =
					!!anchorElement && editable.contains(anchorElement);
				const focusInEditable =
					!!active &&
					(active === editable || editable.contains(active));
				const focusInTitle =
					!!active &&
					host.contains(active) &&
					active.matches("input, textarea");

				if (!focusInEditable && !focusInTitle && !selectionInEditable) {
					keyboardDismissTouchStartX = null;
					keyboardDismissTouchStartY = null;
					keyboardDismissPreviousY = null;
					keyboardDismissStartedAboveToolbar = false;
					keyboardDismissDidBlur = false;
					keyboardDismissInitialSelection = null;
					return;
				}

				const toolbar =
					host.querySelector<HTMLElement>(".mdxeditor-toolbar");
				if (!toolbar) {
					return;
				}

				const toolbarRect = toolbar.getBoundingClientRect();
				if (toolbarRect.height <= 0) {
					return;
				}

				const touch = touchEvt.touches[0];
				const deltaX = Math.abs(
					touch.clientX - keyboardDismissTouchStartX,
				);
				const deltaY = touch.clientY - keyboardDismissTouchStartY;
				const crossedToolbarTop =
					keyboardDismissPreviousY < toolbarRect.top &&
					touch.clientY >= toolbarRect.top;
				const draggedIntoToolbar =
					touch.clientY >=
					toolbarRect.top + Math.min(toolbarRect.height * 0.35, 24);

				// Web touch events cannot start on the native keyboard itself, so
				// use the toolbar directly above it as the keyboard-edge proxy.
				if (
					deltaY >= 28 &&
					deltaY > deltaX + 16 &&
					(crossedToolbarTop || draggedIntoToolbar)
				) {
					// If the user is actively manipulating a text selection
					// (either had one at touchstart, or extended one during
					// the drag via a selection handle), don't blur — that
					// would collapse the selection they're working on.
					const currentSelection = snapshotSelection();
					const hadSelectionAtStart =
						!!keyboardDismissInitialSelection &&
						!keyboardDismissInitialSelection.isCollapsed;
					const selectionChangedDuringDrag = selectionsDiffer(
						keyboardDismissInitialSelection,
						currentSelection,
					);
					if (
						selectionInEditable &&
						currentSelection &&
						!currentSelection.isCollapsed &&
						(hadSelectionAtStart || selectionChangedDuringDrag)
					) {
						keyboardDismissTouchStartX = null;
						keyboardDismissTouchStartY = null;
						keyboardDismissPreviousY = null;
						keyboardDismissStartedAboveToolbar = false;
						keyboardDismissInitialSelection = null;
						return;
					}

					keyboardDismissDidBlur = true;
					keyboardDismissTouchStartX = null;
					keyboardDismissTouchStartY = null;
					keyboardDismissPreviousY = null;
					keyboardDismissStartedAboveToolbar = false;
					keyboardDismissInitialSelection = null;
					if (active && active !== activeDocument.body) {
						active.blur();
					} else {
						editable.blur();
					}
					return;
				}

				keyboardDismissPreviousY = touch.clientY;
			};

			const onTouchEndCapture = (_evt: Event) => {
				keyboardDismissTouchStartX = null;
				keyboardDismissTouchStartY = null;
				keyboardDismissPreviousY = null;
				keyboardDismissStartedAboveToolbar = false;
				keyboardDismissDidBlur = false;
				keyboardDismissInitialSelection = null;

				if (!pendingCheckboxLi) return;
				const li = pendingCheckboxLi;
				pendingCheckboxLi = null;

				// Toggle via Lexical directly — avoids the editor.focus() call
				// that Lexical's own click handler makes, which would pop up the
				// iOS keyboard and scroll the caret into view.
				const contentEditable =
					hostRef.current?.querySelector<LexicalContentEditable>(
						".mxeditor-content-editable",
					) ?? null;
				const lexicalEditor = contentEditable?.__lexicalEditor;
				if (!lexicalEditor) return;

				const wasEditorFocused =
					!!contentEditable &&
					(contentEditable === activeDocument.activeElement ||
						contentEditable.contains(activeDocument.activeElement));

				lexicalEditor.update(() => {
					const node = $getNearestNodeFromDOMNode(li);
					if ($isListItemNode(node)) {
						node.setChecked(!node.getChecked());
					}
				});

				// If the editor wasn't active before the toggle, blur whatever
				// Lexical may have focused so the keyboard doesn't appear.
				if (!wasEditorFocused) {
					window.setTimeout(() => {
						const active =
							activeDocument.activeElement as HTMLElement | null;
						if (active && editable.contains(active)) {
							active.blur();
						}
					}, 0);
				}
			};

			const onKeyDownCapture = (evt: KeyboardEvent) => {
				if (evt.key !== " ") {
					return;
				}

				const selection = window.getSelection();
				if (!selection) {
					return;
				}

				const anchorNode = selection.anchorNode;
				if (!anchorNode) {
					return;
				}

				const anchorElement =
					anchorNode.nodeType === Node.ELEMENT_NODE
						? (anchorNode as Element)
						: anchorNode.parentElement;

				if (!anchorElement) {
					return;
				}

				const li = anchorElement.closest('li[role="checkbox"]');
				if (!li) {
					return;
				}

				// Prevent Lexical's checklist "Space toggles checkbox" behavior
				// while still allowing the browser to insert a space.
				evt.stopImmediatePropagation();
			};

			const onTouchCancelCapture = () => {
				keyboardDismissTouchStartX = null;
				keyboardDismissTouchStartY = null;
				keyboardDismissPreviousY = null;
				keyboardDismissStartedAboveToolbar = false;
				keyboardDismissDidBlur = false;
				keyboardDismissInitialSelection = null;
				pendingCheckboxLi = null;
			};

			const onKeyboardDismissTouchStartCapture = (evt: Event) => {
				keyboardDismissTouchStartX = null;
				keyboardDismissTouchStartY = null;
				keyboardDismissPreviousY = null;
				keyboardDismissStartedAboveToolbar = false;
				keyboardDismissDidBlur = false;
				keyboardDismissInitialSelection = null;

				if (!isMobileTouchDevice) {
					return;
				}

				const touchEvt = evt as TouchEvent;
				if (touchEvt.touches.length !== 1) {
					return;
				}

				const active =
					activeDocument.activeElement as HTMLElement | null;
				const selection = window.getSelection();
				const anchorNode = selection?.anchorNode;
				const anchorElement =
					anchorNode?.nodeType === Node.ELEMENT_NODE
						? (anchorNode as Element)
						: anchorNode?.parentElement;
				const selectionInEditable =
					!!anchorElement && editable.contains(anchorElement);
				const focusInEditable =
					!!active &&
					(active === editable || editable.contains(active));
				const focusInTitle =
					!!active &&
					host.contains(active) &&
					active.matches("input, textarea");

				if (!focusInEditable && !focusInTitle && !selectionInEditable) {
					return;
				}

				const toolbar =
					host.querySelector<HTMLElement>(".mdxeditor-toolbar");
				if (!toolbar) {
					return;
				}

				const toolbarRect = toolbar.getBoundingClientRect();
				if (toolbarRect.height <= 0) {
					return;
				}

				const touch = touchEvt.touches[0];
				if (touch.clientY >= toolbarRect.top) {
					return;
				}

				keyboardDismissTouchStartX = touch.clientX;
				keyboardDismissTouchStartY = touch.clientY;
				keyboardDismissPreviousY = touch.clientY;
				keyboardDismissStartedAboveToolbar = true;
				keyboardDismissInitialSelection = snapshotSelection();
			};

			editable.addEventListener(
				"pointerdown",
				onPointerDownCapture,
				true,
			);
			editable.addEventListener("keydown", onKeyDownCapture, true);
			host.addEventListener(
				"touchstart",
				onKeyboardDismissTouchStartCapture,
				true,
			);
			editable.addEventListener("touchstart", onTouchStartCapture, {
				capture: true,
				passive: false,
			});
			host.addEventListener("touchmove", onTouchMoveCapture, true);
			editable.addEventListener("touchend", onTouchEndCapture, true);
			host.addEventListener("touchend", onTouchEndCapture, true);
			host.addEventListener("touchcancel", onTouchCancelCapture, true);

			// Strip tabindex from li[role="checkbox"] so iOS never focuses the
			// li element itself. Without tabindex, tapping the text span naturally
			// focuses the contenteditable and places the caret at the tap point.
			const stripTabIndex = (root: Element) => {
				root.querySelectorAll('li[role="checkbox"]').forEach((li) =>
					li.removeAttribute("tabindex"),
				);
			};
			stripTabIndex(editable);

			const tabIndexObserver = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === "childList") {
						mutation.addedNodes.forEach((node) => {
							if (!node.instanceOf(Element)) return;
							if (node.matches('li[role="checkbox"]'))
								node.removeAttribute("tabindex");
							stripTabIndex(node);
						});
					} else if (
						mutation.type === "attributes" &&
						mutation.target.instanceOf(Element) &&
						mutation.target.matches('li[role="checkbox"]')
					) {
						mutation.target.removeAttribute("tabindex");
					}
				}
			});
			tabIndexObserver.observe(editable, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["tabindex"],
			});

			// Keep the caret visible above the on-screen keyboard. Obsidian
			// mobile may not update visualViewport when the keyboard opens, so
			// we compute the visible bottom as the smallest of: the scroller's
			// own bottom, visualViewport bottom, and window.innerHeight.
			const findScroller = (): HTMLElement | null =>
				host.querySelector<HTMLElement>(
					".mdxeditor-root-contenteditable",
				);
			const ensureCaretVisible = () => {
				const active =
					activeDocument.activeElement as HTMLElement | null;
				const focusInEditor =
					!!active &&
					(active === editable || editable.contains(active));
				if (!focusInEditor) return;

				const scroller = findScroller();
				if (!scroller) return;

				const sel = window.getSelection();
				if (!sel || sel.rangeCount === 0) return;

				const range = sel.getRangeAt(0).cloneRange();
				range.collapse(false);
				let rect = range.getBoundingClientRect();
				const focusNode = sel.focusNode;
				const focusEl: Element | null =
					focusNode?.nodeType === Node.ELEMENT_NODE
						? (focusNode as Element)
						: (focusNode?.parentElement ?? null);
				if (rect.height === 0 && rect.width === 0 && focusEl) {
					rect = focusEl.getBoundingClientRect();
				}
				if (rect.height === 0 && rect.width === 0) return;

				const scrollerRect = scroller.getBoundingClientRect();
				const viewport = window.visualViewport;
				const viewportBottom = viewport
					? viewport.offsetTop + viewport.height
					: Number.POSITIVE_INFINITY;
				const visibleBottom = Math.min(
					scrollerRect.bottom,
					viewportBottom,
					window.innerHeight,
				);
				const margin = 32;
				if (rect.bottom <= visibleBottom - margin) return;

				const delta = rect.bottom - (visibleBottom - margin);
				scroller.scrollTop += delta;
			};
			let selectionCheckQueued = false;
			const onSelectionChange = () => {
				if (selectionCheckQueued) return;
				selectionCheckQueued = true;
				// Multiple passes to cover the iOS keyboard animation window.
				window.setTimeout(ensureCaretVisible, 50);
				window.setTimeout(ensureCaretVisible, 350);
				window.setTimeout(() => {
					selectionCheckQueued = false;
					ensureCaretVisible();
				}, 600);
			};
			activeDocument.addEventListener(
				"selectionchange",
				onSelectionChange,
			);

			return () => {
				editable.removeEventListener(
					"pointerdown",
					onPointerDownCapture,
					true,
				);
				editable.removeEventListener("keydown", onKeyDownCapture, true);
				host.removeEventListener(
					"touchstart",
					onKeyboardDismissTouchStartCapture,
					true,
				);
				editable.removeEventListener(
					"touchstart",
					onTouchStartCapture,
					true,
				);
				host.removeEventListener("touchmove", onTouchMoveCapture, true);
				editable.removeEventListener(
					"touchend",
					onTouchEndCapture,
					true,
				);
				host.removeEventListener("touchend", onTouchEndCapture, true);
				host.removeEventListener(
					"touchcancel",
					onTouchCancelCapture,
					true,
				);
				tabIndexObserver.disconnect();
				activeDocument.removeEventListener(
					"selectionchange",
					onSelectionChange,
				);
			};
		}, []);

		// Mirror each code block's language onto a `data-code-lang` attribute of
		// its wrapper, so CSS can render a small, non-interactive language flair
		// (like Obsidian's). MDXEditor's own language control lives in a toolbar
		// that is hidden until the block is focused.
		useEffect(() => {
			const host = hostRef.current;
			if (!host) {
				return;
			}

			let frame = 0;
			const sync = () => {
				frame = 0;
				host.querySelectorAll<HTMLElement>(
					'[class*="_codeMirrorWrapper_"]',
				).forEach((wrapper) => {
					const trigger = wrapper.querySelector(
						'button[aria-label="Language"]',
					);
					const label = trigger?.textContent?.trim() ?? "";
					const id =
						CODE_BLOCK_LABEL_TO_ID.get(label) ?? label.toLowerCase();
					if (id) {
						wrapper.setAttribute("data-code-lang", id);
					} else {
						wrapper.removeAttribute("data-code-lang");
					}
				});
			};

			const scheduleSync = () => {
				if (frame === 0) {
					frame = window.requestAnimationFrame(sync);
				}
			};

			sync();
			const observer = new MutationObserver(scheduleSync);
			observer.observe(host, {
				childList: true,
				subtree: true,
				characterData: true,
			});

			return () => {
				observer.disconnect();
				if (frame !== 0) {
					window.cancelAnimationFrame(frame);
				}
			};
		}, []);

		const handleContentChange = (newMarkdown: string) => {
			props.onSave(newMarkdown);
		};

		// Handler for Ctrl + Click on links
		const handleEditorClick = (e: ReactMouseEvent) => {
			const target = e.target as HTMLElement;
			const anchor = target.closest("a");
			if (!anchor) {
				return false;
			}

			const href = anchor.getAttribute("href");
			if (!href) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			// Lexical may sanitize custom schemes => href becomes about:blank.
			// In that case, use the rendered link text as the source of truth.
			const text = (anchor.textContent ?? "").trim();

			if (
				href === "about:blank" &&
				text.startsWith("#") &&
				text.length > 1
			) {
				const tag = text.slice(1);
				window.open(
					"obsidian://search?query=" +
						encodeURIComponent("tag:#" + tag),
					"_blank",
					"noopener,noreferrer",
				);
				return;
			}

			// about:blank with non-tag text == sanitized internal link.
			if (href === "about:blank" && text.length > 0) {
				props.onNavigate(text);
				return;
			}

			// Lexical's link plugin auto-prefixes scheme-less hrefs with
			// "https://", so a wikilink to "My Note" ends up as
			// "https://My%20Note". Two cases to detect:
			//   1. Non-aliased: stripped href matches the rendered text.
			//   2. Aliased ([Alias](My Note)): text is the alias, so it
			//      won't match — instead, check that the "hostname" portion
			//      contains no dot. Real domains always have a TLD; vault
			//      basenames almost never do.
			const wasAutoPrefixed = /^https?:\/\//i.test(href);
			const strippedHref = (() => {
				try {
					return decodeURI(href.replace(/^https?:\/\//i, ""));
				} catch {
					return href.replace(/^https?:\/\//i, "");
				}
			})();
			if (text.length > 0 && strippedHref === text) {
				props.onNavigate(text);
				return;
			}
			if (wasAutoPrefixed) {
				const hostPart = strippedHref
					.split("/")[0]
					.split("#")[0]
					.split("?")[0];
				if (hostPart.length > 0 && !hostPart.includes(".")) {
					props.onNavigate(strippedHref);
					return;
				}
			}

			// Internal links (stored as URI-encoded basenames like
			// "My%20Note") have no URL scheme — route them through
			// Obsidian's link opener so the target file opens inside the
			// workspace instead of the browser.
			const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
			if (!hasScheme) {
				props.onNavigate(decodeURI(href));
				return;
			}

			window.open(href, "_blank", "noopener,noreferrer");
		};

		const TitleBar = () => {
			const [value, setValue] = useState(internalTitle);

			// Sync local state if the file changes externally
			useEffect(() => setValue(internalTitle), [internalTitle]);

			const handleSave = async () => {
				if (value.trim() === internalTitle) return;

				const success = await props.onRename(value);

				if (!success) {
					setValue(internalTitle);
				} else {
					setValue(value);
				}
			};

			return (
				<input
					className="custom-title-input"
					value={value}
					placeholder="Title"
					onChange={(e) => setValue(e.target.value)}
					// Save when user clicks away
					onBlur={() => {
						handleSave().catch((err) => {
							console.error("Failed to save title:", err);
						});
					}}
					// Save when user hits Enter
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();

							void (async () => {
								await handleSave();

								window.setTimeout(() => {
									const root = hostRef.current?.querySelector(
										".mxeditor-content-editable",
									);
									if (root) {
										const range =
											activeDocument.createRange();
										range.selectNodeContents(root);
										range.collapse(true);

										const selection = window.getSelection();
										if (selection) {
											selection.removeAllRanges();
											selection.addRange(range);
										}
										editorRef.current?.focus();
									}
								}, 100);
							})();
						}
					}}
				/>
			);
		};

		return (
			<div
				ref={hostRef}
				className="react-root"
				onMouseDownCapture={(e) => {
					handleEditorClick(e);
				}}
			>
				<MDXEditor
					className={isDark ? "dark-theme dark-editor" : ""}
					ref={editorRef}
					markdown={props.text}
					onChange={handleContentChange}
					contentEditableClassName="mxeditor-content-editable"
					suppressHtmlProcessing={true}
					plugins={[
						toolbarPlugin({
							toolbarContents: () => (
								<>
									<UndoRedo />
									<BoldItalicUnderlineToggles />
									<ListsToggle />
									<IndentControls
										editorRef={editorRef.current}
									/>
									<BlockTypeSelect />

									<StrikeThroughSupSubToggles />
									<HighlightToggle />
									<CodeToggle />
									<InsertCodeBlock />
									<InsertThematicBreak />
									<CreateLink />
									<InsertWikilink
										onPickInternalLink={
											props.onPickInternalLink
										}
									/>
									<InsertImage />
									<InsertTable />
									<InsertCallout />
									<InsertFootnote />
								</>
							),
						}),
						headingsPlugin(),
						listsPlugin(),
						quotePlugin(),
						// directivesPlugin supplies the directive Markdown
						// grammar; calloutPlugin supplies the callout node.
						directivesPlugin({ directiveDescriptors: [] }),
						calloutPlugin(),
						footnotePlugin(),
						autoLinkTitlePlugin(),
						thematicBreakPlugin(),
						markdownShortcutPlugin(),
						tablePlugin(),
						imagePlugin({
							disableImageResize: true,

							// 1. Handle Uploads (what you just did)
							imageUploadHandler: async (image: File) => {
								return await props.onImageUpload(image);
							},
							// 2. Handle Viewing (resolve vault paths to viewable URLs)
							imagePreviewHandler: (imageSource: string) => {
								if (imageSource.startsWith("http")) {
									return Promise.resolve(imageSource);
								}
								// Explicitly return a promise to satisfy the type requirement
								return Promise.resolve(
									props.onResolveImage(imageSource),
								);
							},
						}),
						linkPlugin(),
						tagLinkPlugin(),
						linkDialogPlugin({ showLinkTitleField: false }),
						codeBlockPlugin({ defaultCodeBlockLanguage: "js" }),
						codeMirrorPlugin({
							codeBlockLanguages: CODE_BLOCK_LANGUAGES,

							codeMirrorExtensions: isDark ? [oneDark] : [],
						}),
						obsidianEmbedPlugin(),
					]}
				/>
				{propertiesContainer &&
					createPortal(
						<PropertiesDisplay properties={properties} />,
						propertiesContainer,
					)}
				{titleBarContainer &&
					createPortal(<TitleBar />, titleBarContainer)}
			</div>
		);
	},
);
