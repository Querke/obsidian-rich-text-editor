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

interface Props {
	title: string;
	text: string;
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => Promise<boolean>;
	onImageUpload: (image: File) => Promise<string>;
	onResolveImage: (src: string) => string;
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
					".mdxeditor"
				) as HTMLElement;

				// Get the container
				const contentEditor = root?.querySelector(
					".mdxeditor-root-contenteditable"
				);
				// Get the specific first child element
				const targetChild = contentEditor?.firstElementChild;

				if (targetChild) {
					let bar = root.querySelector(
						".custom-titlebar"
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
					".mxeditor-content-editable"
				);
				if (editable) {
					// Force iOS to Capitalize the first letter of sentences
					editable.setAttribute("autocapitalize", "sentences");
				}
			};

			// Run quickly after mount to override defaults
			setTimeout(enableMobileFeatures, 100);
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
							editorRef.current?.focus();
						}
					}}
				/>
			);
		};

		return (
			<div
				ref={hostRef}
				className="react-root"
				onClick={(e) => focusEditor(e)}
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
								imageSource: string
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
	}
);
