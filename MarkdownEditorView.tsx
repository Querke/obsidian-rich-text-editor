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

interface Props {
	title: string;
	text: string;
	onSave: (newText: string) => void;
	onRename: (nextTitle: string) => void;
}

export const MarkdownEditorView = (props: Props) => {
	const editorRef = useRef<MDXEditorMethods>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);

	const titleState = useState<string>(props.title);

	const handleContentChange = (newMarkdown: string) => {
		props.onSave(newMarkdown);
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
		const host = hostRef.current;
		if (!host) {
			return;
		}
		const root =
			(host.querySelector(".mxeditor") as HTMLElement | null) ??
			(host.querySelector(".mdxeditor") as HTMLElement | null);
		const toolbar = root?.querySelector(
			'[role="toolbar"]'
		) as HTMLElement | null;
		if (!root || !toolbar) {
			return;
		}

		let bar = root.querySelector(
			".custom-titlebar"
		) as HTMLDivElement | null;
		if (!bar) {
			bar = document.createElement("div");
			bar.className = "custom-titlebar";
			toolbar.insertAdjacentElement("afterend", bar);
		}
		bar.innerHTML = "";

		const input = document.createElement("input");
		input.className = "custom-title-input";
		input.type = "text";
		input.value = titleState[0];
		input.placeholder = "Title";
		input.autocomplete = "off";

		const btn = document.createElement("button");
		btn.className = "custom-title-save";
		btn.type = "button";
		btn.textContent = "Save title";

		const save = async () => {
			const next = input.value.trim();
			const res = props.onRename(next);
		};

		const onKey = async (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				await save();
			}
		};

		btn.addEventListener("click", save);
		input.addEventListener("keydown", onKey);

		bar.appendChild(input);
		bar.appendChild(btn);

		return () => {
			btn.removeEventListener("click", save);
			input.removeEventListener("keydown", onKey);
		};
	}, [titleState[0]]);

	const isDark = document.body.classList.contains("theme-dark");

	const cmFontTheme = EditorView.theme({
		"&": {
			fontFamily: "Liberation Mono, Courier New, monospace",
			fontSize: "14px",
		},
	});

	return (
		<div ref={hostRef} className="react-root">
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
					imagePlugin(),
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

						codeMirrorExtensions: isDark
							? [oneDark, cmFontTheme]
							: [cmFontTheme],
					}),
				]}
			/>
		</div>
	);
};
