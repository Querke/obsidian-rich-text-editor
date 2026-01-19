// ReactView.tsx
import { oneDark } from "@codemirror/theme-one-dark";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	Button,
	ButtonWithTooltip,
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
	Separator,
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
import { IndentControls } from "./IndentControls";

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
				console.log("setting internal title " + newTitle);

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

			const editable = hostRef.current.querySelector(
				".mxeditor-content-editable",
			) as HTMLElement | null;
			if (!editable) {
				return;
			}

			const checkboxHitWidthPx = 30;

			const onPointerDownCapture = (evt: PointerEvent) => {
				const target = evt.target as HTMLElement | null;
				if (!target) {
					return;
				}

				const li = target.closest(
					'li[role="checkbox"]',
				) as HTMLElement | null;
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

			return () => {
				editable.removeEventListener(
					"pointerdown",
					onPointerDownCapture,
					true,
				);
				editable.removeEventListener("keydown", onKeyDownCapture, true);
			};
		}, []);

		const handleContentChange = (newMarkdown: string) => {
			props.onSave(newMarkdown);
		};

		function focusEditor(e: React.MouseEvent<HTMLDivElement>): void {
			const target = e.target as HTMLElement;

			// Check if the clicked element has the specific class
			if (target.classList.contains("mdxeditor-root-contenteditable")) {
				editorRef.current?.focus();
			}
		}

		// Handler for Ctrl + Click on links
		const handleEditorClick = (e: React.MouseEvent): boolean => {
			// 1. Check if modifier key is pressed (Ctrl or Meta/Cmd)

			// 2. Find if the target is (or is inside) an anchor tag
			const target = e.target as HTMLElement;
			const anchor = target.closest("a");

			if (!anchor) return false;

			// 3. Get the HREF
			const href = anchor.getAttribute("href");
			if (!href) return false;

			// 4. Ignore external links (let browser/Obsidian handle http)
			if (href.startsWith("http://") || href.startsWith("https://"))
				return false;

			// 5. It's an internal link! Stop editing and navigate.
			e.preventDefault();
			e.stopPropagation();

			// Decode URI (e.g. "Three%20Laws" -> "Three Laws")
			const decodedPath = decodeURI(href);
			props.onNavigate(decodedPath);

			return true;
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
					onBlur={handleSave}
					// Save when user hits Enter
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleSave();
							setTimeout(() => {
								// 1. Get the actual content editable root
								const root = hostRef.current?.querySelector(
									".mxeditor-content-editable",
								);

								if (root) {
									// 2. Create a new Range
									const range = document.createRange();

									// 3. Select the entire content of the editor
									range.selectNodeContents(root);

									// 4. Collapse the range to the start (true = start, false = end)
									range.collapse(true);

									// 5. Apply the selection
									const selection = window.getSelection();
									if (selection) {
										selection.removeAllRanges();
										selection.addRange(range);
									}

									// 6. Ensure the editor is technically focused
									editorRef.current?.focus();
								}
							}, 100);
						}
					}}
				/>
			);
		};

		return (
			<div
				ref={hostRef}
				className="react-root"
				onClick={(e) => {
					if (!handleEditorClick(e)) focusEditor(e);
				}}
			>
				<MDXEditor
					className={isDark ? "dark-theme dark-editor" : ""}
					ref={editorRef}
					markdown={props.text}
					onChange={handleContentChange}
					contentEditableClassName="mxeditor-content-editable"
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
							imagePreviewHandler: async (
								imageSource: string,
							) => {
								if (imageSource.startsWith("http")) {
									return imageSource;
								}
								// The return value will be automatically wrapped in a Promise
								return props.onResolveImage(imageSource);
							},
						}),
						linkPlugin(),
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
