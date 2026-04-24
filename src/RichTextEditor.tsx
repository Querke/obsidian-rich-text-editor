// ReactView.tsx
import { oneDark } from "@codemirror/theme-one-dark";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	codeBlockPlugin,
	codeMirrorPlugin,
	CodeToggle,
	CreateLink,
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
import { createPortal } from "react-dom";
import { $getNearestNodeFromDOMNode } from "lexical";
import { $isListItemNode } from "@lexical/list";
import { IndentControls } from "./IndentControls";
import { tagLinkPlugin } from "./tagLinkPlugin";

interface Props {
	title: string;
	text: string;
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => Promise<boolean>;
	onImageUpload: (image: File) => Promise<string>;
	onResolveImage: (src: string) => string;
	onNavigate: (path: string) => void;
}

export interface RichTextEditorRef {
	setTitle: (title: string) => void;
	setMarkdown: (markdown: string) => void;
}

export const RichTextEditor = forwardRef<RichTextEditorRef, Props>(
	(props, ref) => {
		const editorRef = useRef<MDXEditorMethods>(null);
		const hostRef = useRef<HTMLDivElement | null>(null);

		const [internalTitle, setInternalTitle] = useState(props.title);

		const [titleBarContainer, setTitleBarContainer] =
			useState<HTMLElement | null>(null);

		const isDark = document.body.classList.contains("theme-dark");

		useImperativeHandle(ref, () => ({
			// Logic A: Update Title Bar state
			setTitle: (newTitle: string) => {
				setInternalTitle(newTitle);
			},
			// Logic B: Proxy the setMarkdown call to the library
			setMarkdown: (markdown: string) => {
				editorRef.current?.setMarkdown(markdown);
			},
		}));

		useEffect(() => {
			if (!hostRef.current) return;

			// Wait for MDXEditor to render
			setTimeout(() => {
				const root = hostRef.current?.querySelector(
					".mdxeditor",
				) as HTMLElement;

				// Get the container
				const contentEditor = root?.querySelector(
					".mdxeditor-root-contenteditable",
				);
				// Get the specific first child element
				const targetChild = contentEditor?.firstElementChild;

				if (targetChild) {
					let bar = root.querySelector(
						".custom-titlebar",
					) as HTMLElement;
					if (!bar) {
						bar = document.createElement("div");
						bar.className = "custom-titlebar";
						// Inject at the start of the first child element
						targetChild.prepend(bar);
					}

					// Save this DOM element to state
					setTitleBarContainer(bar);
				}
			}, 0);
		}, []);

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
			setTimeout(enableMobileFeatures, 100);
		}, []);

		useEffect(() => {
			if (!hostRef.current) {
				return;
			}

			const editable: HTMLElement | null = hostRef.current.querySelector(
				".mxeditor-content-editable",
			);
			if (!editable) {
				return;
			}

			const checkboxHitWidthPx = 30;

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
				const target = document.elementFromPoint(
					touch.clientX,
					touch.clientY,
				) as HTMLElement | null;
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

			const onTouchEndCapture = (_evt: Event) => {
				if (!pendingCheckboxLi) return;
				const li = pendingCheckboxLi;
				pendingCheckboxLi = null;

				// Toggle via Lexical directly — avoids the editor.focus() call
				// that Lexical's own click handler makes, which would pop up the
				// iOS keyboard and scroll the caret into view.
				const contentEditable = hostRef.current?.querySelector(
					".mxeditor-content-editable",
				) as HTMLElement | null;
				// @ts-ignore
				const lexicalEditor = (contentEditable as any)?.__lexicalEditor;
				if (!lexicalEditor) return;

				const wasEditorFocused =
					!!contentEditable &&
					(contentEditable === document.activeElement ||
						contentEditable.contains(document.activeElement));

				lexicalEditor.update(() => {
					const node = $getNearestNodeFromDOMNode(li);
					if ($isListItemNode(node)) {
						node.setChecked(!node.getChecked());
					}
				});

				// If the editor wasn't active before the toggle, blur whatever
				// Lexical may have focused so the keyboard doesn't appear.
				if (!wasEditorFocused) {
					setTimeout(() => {
						const active =
							document.activeElement as HTMLElement | null;
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

			editable.addEventListener(
				"pointerdown",
				onPointerDownCapture,
				true,
			);
			editable.addEventListener("keydown", onKeyDownCapture, true);
			editable.addEventListener("touchstart", onTouchStartCapture, {
				capture: true,
				passive: false,
			});
			editable.addEventListener("touchend", onTouchEndCapture, true);

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
							if (!(node instanceof Element)) return;
							if (node.matches('li[role="checkbox"]'))
								node.removeAttribute("tabindex");
							stripTabIndex(node);
						});
					} else if (
						mutation.type === "attributes" &&
						mutation.target instanceof Element &&
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

			return () => {
				editable.removeEventListener(
					"pointerdown",
					onPointerDownCapture,
					true,
				);
				editable.removeEventListener("keydown", onKeyDownCapture, true);
				editable.removeEventListener(
					"touchstart",
					onTouchStartCapture,
					true,
				);
				editable.removeEventListener(
					"touchend",
					onTouchEndCapture,
					true,
				);
				tabIndexObserver.disconnect();
			};
		}, []);

		const handleContentChange = (newMarkdown: string) => {
			props.onSave(newMarkdown);
		};

		// Handler for Ctrl + Click on links
		const handleEditorClick = (e: React.MouseEvent) => {
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

								setTimeout(() => {
									const root = hostRef.current?.querySelector(
										".mxeditor-content-editable",
									);
									if (root) {
										const range = document.createRange();
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
									<InsertImage />
									<InsertTable />
								</>
							),
						}),
						headingsPlugin(),
						listsPlugin(),
						quotePlugin(),
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
						linkDialogPlugin(),
						codeBlockPlugin({ defaultCodeBlockLanguage: "js" }),
						codeMirrorPlugin({
							codeBlockLanguages: {
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
							},

							codeMirrorExtensions: isDark ? [oneDark] : [],
						}),
					]}
				/>
				{titleBarContainer &&
					createPortal(<TitleBar />, titleBarContainer)}
			</div>
		);
	},
);
