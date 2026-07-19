import { $patchStyleText } from "@lexical/selection";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createRangeSelection,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$setSelection,
	type PointType,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

const COLORS = [
	"#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#ffffff",
	"#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff",
	"#9900ff", "#ff00ff", "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3",
	"#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc", "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599",
	"#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd", "#cc0000", "#e69138",
	"#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79", "#660000",
	"#783f04", "#7f6000", "#274e13", "#0c343d", "#073763", "#20124d", "#4c1130",
];

type SavedSelection = {
	anchor: Pick<PointType, "key" | "offset" | "type">;
	focus: Pick<PointType, "key" | "offset" | "type">;
};

export function TextColorPicker() {
	const [editor] = useLexicalComposerContext();
	const [color, setColor] = useState("#2dc26b");
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const selectionRef = useRef<SavedSelection | null>(null);

	const rememberSelection = () => {
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			selectionRef.current = $isRangeSelection(selection)
				? {
					anchor: { key: selection.anchor.key, offset: selection.anchor.offset, type: selection.anchor.type },
					focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
				}
				: null;
		});
	};

	const applyColor = (nextColor: string) => {
		setColor(nextColor);
		editor.update(() => {
			let selection = $getSelection();
			const saved = selectionRef.current;
			if (!$isRangeSelection(selection) && saved && $getNodeByKey(saved.anchor.key) && $getNodeByKey(saved.focus.key)) {
				const restoredSelection = $createRangeSelection();
				restoredSelection.anchor.set(saved.anchor.key, saved.anchor.offset, saved.anchor.type);
				restoredSelection.focus.set(saved.focus.key, saved.focus.offset, saved.focus.type);
				$setSelection(restoredSelection);
				selection = restoredSelection;
			}
			if ($isRangeSelection(selection)) $patchStyleText(selection, { color: nextColor });
		});
		editor.focus();
	};

	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
		};
		const ownerDocument = triggerRef.current?.ownerDocument ?? activeDocument;
		ownerDocument.addEventListener("pointerdown", close);
		return () => ownerDocument.removeEventListener("pointerdown", close);
	}, [open]);

	const rect = triggerRef.current?.getBoundingClientRect();
	const ownerWindow = triggerRef.current?.ownerDocument.defaultView ?? window;
	const panelStyle = rect
		? { left: Math.max(8, Math.min(rect.left, ownerWindow.innerWidth - 228)), top: rect.bottom + 5 }
		: undefined;
	const preserveSelection = (event: ReactMouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className="rte-color-trigger"
				title="Text color"
				aria-label="Text color"
				aria-expanded={open}
				onMouseDown={(event) => {
					preserveSelection(event);
					rememberSelection();
				}}
				onClick={() => setOpen(!open)}
			>
				<span>A<i style={{ backgroundColor: color }} /></span>
			</button>
			{open && createPortal(
				<div ref={panelRef} className="rte-color-panel" style={panelStyle} onMouseDown={preserveSelection}>
					<div className="rte-color-grid">
						{COLORS.map((item) => (
							<button key={item} type="button" className="rte-color-swatch" title={item}
								aria-label={`Set text color to ${item}`} style={{ backgroundColor: item }}
								onClick={() => applyColor(item)} />
						))}
					</div>
					<label className="rte-color-custom">
						<span>Custom</span>
						<input type="color" value={color} title="Choose custom text color"
							onMouseDown={(event) => event.stopPropagation()}
							onChange={(event) => applyColor(event.currentTarget.value)} />
					</label>
				</div>,
				triggerRef.current?.ownerDocument.body ?? activeDocument.body,
			)}
		</>
	);
}
