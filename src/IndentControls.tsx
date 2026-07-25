import { rootEditor$, SingleChoiceToggleGroup } from "@mdxeditor/editor";
import { useCellValue } from "@mdxeditor/gurx";
import { INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND } from "lexical";
import { getIcon } from "obsidian";

export const IndentControls = () => {
	const editor = useCellValue(rootEditor$);

	const triggerIndent = (isOutdent: boolean) => {
		if (!editor) return;
		editor.focus();
		editor.dispatchCommand(
			isOutdent ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
			undefined,
		);
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
