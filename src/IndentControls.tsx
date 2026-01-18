import { ButtonWithTooltip, MDXEditorMethods } from "@mdxeditor/editor";

interface Props {
	editorRef: MDXEditorMethods | null;
}

export const IndentControls = (props: Props) => {
	// Helper to simulate Tab / Shift+Tab
	const triggerIndent = (isOutdent: boolean) => {
		props.editorRef?.focus();

		// Timeout ensures the editor is focused before manipulation
		setTimeout(async () => {
			const selection = window.getSelection();
			const activeElement = document.activeElement;
			const originalOffset = selection?.focusOffset || 0;

			// 1. Move cursor to start of the line
			if (selection && selection.rangeCount > 0) {
				try {
					// "lineboundary" moves to the visual start of the line
					selection.modify("move", "backward", "lineboundary");
				} catch (e) {
					// Fallback if browser doesn't support modify (unlikely in Obsidian)
					console.warn("Failed to move cursor to start", e);
				}
			}

			await new Promise((resolve) => setTimeout(resolve, 1));

			// 2. Dispatch the synthetic Tab event
			if (activeElement) {
				const event = new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "Tab",
					code: "Tab",
					shiftKey: isOutdent, // Shift+Tab = Outdent
				});
				activeElement.dispatchEvent(event);
			}

			await new Promise((resolve) => setTimeout(resolve, 1));

			// 3. Move cursor back to original position
			if (selection && selection.rangeCount > 0) {
				selection.collapse(selection.focusNode, originalOffset);
			}
		}, 0);
	};

	return (
		<>
			<ButtonWithTooltip
				title="Decrease indent"
				onClick={() => triggerIndent(true)}
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M4 19V17H12V19H4ZM4 13V11H12V13H4ZM4 7V5H12V7H4ZM16.5 15.5L13 12L16.5 8.5L17.55 9.55L15.1 12L17.55 14.45L16.5 15.5Z"
						fill="currentColor"
					/>
				</svg>
			</ButtonWithTooltip>

			<ButtonWithTooltip
				title="Increase indent"
				onClick={() => triggerIndent(false)}
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M4 19V17H12V19H4ZM4 13V11H12V13H4ZM4 7V5H12V7H4ZM20 12L16.5 15.5L15.45 14.45L17.9 12L15.45 9.55L16.5 8.5L20 12Z"
						fill="currentColor"
					/>
				</svg>
			</ButtonWithTooltip>
		</>
	);
};
