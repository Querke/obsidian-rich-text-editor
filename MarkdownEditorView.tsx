// ReactView.tsx
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
	title: string;
	text: string;
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => void;
	onImageUpload: (image: File) => Promise<string>;
	onResolveImage: (src: string) => string;
}

export const MarkdownEditorView = (props: Props) => {
	const editorRef = useRef<MDXEditorMethods>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [titleBarContainer, setTitleBarContainer] =
		useState<HTMLElement | null>(null);

	const titleState = useState<string>(props.title);

	const handleContentChange = (newMarkdown: string) => {
		props.onSave(newMarkdown);
	};

	const handleWrapperClick = (e: React.MouseEvent) => {
		// Only focus if the user clicked the background wrapper directly,
		// not if they clicked an actual paragraph/image inside it.
		if (e.target === e.currentTarget) {
			editorRef.current?.focus();
		}
	};

	useEffect(() => {
		if (props.title !== titleState[0]) {
			titleState[1](props.title);
			const input = hostRef.current?.querySelector(
				".custom-title-input"
			) as HTMLInputElement | null;
			if (input && input.value !== props.title) {
				input.value = props.title;
			}
		}
	}, [props.title]);

	useEffect(() => {
		if (!hostRef.current) return;

		// Wait for MDXEditor to render
		setTimeout(() => {
			const root = hostRef.current?.querySelector(
				".mdxeditor"
			) as HTMLElement;
			const toolbar = root?.querySelector('[role="toolbar"]');

			if (toolbar) {
				let bar = root.querySelector(".custom-titlebar") as HTMLElement;
				if (!bar) {
					bar = document.createElement("div");
					bar.className = "custom-titlebar";
					// Inject the empty DIV into the DOM
					toolbar.insertAdjacentElement("afterend", bar);
				}

				// Save this DOM element to state
				setTitleBarContainer(bar);
			}
		}, 0);
	}, []);

	// 2. Define your component as standard JSX
	const TitleBar = () => {
		const [value, setValue] = useState(props.title);

		// Update local state when file changes
		useEffect(() => setValue(props.title), [props.title]);

		return (
			<>
				<input
					className="custom-title-input"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) =>
						e.key === "Enter" && props.onRename(value)
					}
				/>
				<button
					className="custom-title-save"
					onClick={() => props.onRename(value)}
				>
					Save
				</button>
			</>
		);
	};

	const isDark = document.body.classList.contains("theme-dark");

	function focusEditor(e: React.MouseEvent<HTMLDivElement>): void {
		if (
			(e.target as HTMLElement).classList.contains("custom-title-input")
		) {
			return;
		}

		editorRef.current?.focus();
	}

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
								<Separator />
								<BoldItalicUnderlineToggles />
								<StrikeThroughSupSubToggles />
								<HighlightToggle />
								<CodeToggle />
								<InsertCodeBlock />
								<InsertThematicBreak />
								<BlockTypeSelect />
								<Separator />
								<ListsToggle />
								<Separator />
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
						// 1. Handle Uploads (what you just did)
						imageUploadHandler: async (image: File) => {
							return await props.onImageUpload(image);
						},
						// 2. Handle Viewing (resolve vault paths to viewable URLs)
						imagePreviewHandler: async (imageSource: string) => {
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
			{titleBarContainer && createPortal(<TitleBar />, titleBarContainer)}
		</div>
	);
};
