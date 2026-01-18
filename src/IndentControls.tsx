import {
	ButtonWithTooltip,
	MDXEditorMethods,
	SingleChoiceToggleGroup,
} from "@mdxeditor/editor";
import { getIcon } from "obsidian";

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
		<SingleChoiceToggleGroup
			value="" // Always empty so buttons don't stay "selected"
			onChange={(value) => {
				if (value === "outdent") triggerIndent(true);
				if (value === "indent") triggerIndent(false);
			}}
			items={[
				{
					title: "Decrease indent",
					value: "outdent",
					// Obsidian/Lucide icon for outdent
					contents: <ObsidianIcon iconId="outdent" />,
				},
				{
					title: "Increase indent",
					value: "indent",
					// Obsidian/Lucide icon for indent
					contents: <ObsidianIcon iconId="indent" />,
				},
			]}
		/>
	);
};

const ObsidianIcon = ({ iconId }: { iconId: string }) => {
	const iconEl = getIcon(iconId);
	if (!iconEl) return null;

	// Convert the SVG element to an HTML string for React
	return (
		<span
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "24px",
				height: "24px",
			}}
			dangerouslySetInnerHTML={{ __html: iconEl.outerHTML }}
		/>
	);
};
