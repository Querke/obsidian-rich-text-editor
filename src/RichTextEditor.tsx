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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
	title: string;
	text: string;
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => Promise<boolean>;
	onImageUpload: (image: File) => Promise<string>;
	onResolveImage: (src: string) => string;
}

export const RichTextEditor = (props: Props) => {
	const editorRef = useRef<MDXEditorMethods>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [titleBarContainer, setTitleBarContainer] =
		useState<HTMLElement | null>(null);

	const isDark = document.body.classList.contains("theme-dark");

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

	const handleContentChange = (newMarkdown: string) => {
		props.onSave(newMarkdown);
	};

	function focusEditor(e: React.MouseEvent<HTMLDivElement>): void {
		if (
			(e.target as HTMLElement).classList.contains("custom-title-input")
		) {
			return;
		}

		editorRef.current?.focus();
	}

	const TitleBar = () => {
		const [value, setValue] = useState(props.title);

		// Sync local state if the file changes externally
		useEffect(() => setValue(props.title), [props.title]);

		const handleSave = async () => {
			// 1. Don't trigger if nothing changed
			if (value.trim() === props.title) return;

			// 2. Call the rename function and wait for the result
			const success = await props.onRename(value);

			// 3. If rename failed (returned false), revert the input to the old title
			if (!success) {
				setValue(props.title);
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
						handleSave();
						e.currentTarget.blur(); // Remove focus from input
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
						disableImageResize: true,

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
