// Host for the editor's docked bars — full-width strips that dock to the editor
// chrome instead of floating over the text: in normal flow just below the
// formatting toolbar on desktop, and pinned directly above it on mobile (where
// the toolbar is glued to the top of the on-screen keyboard).
//
// A single container owns all of them so several bars (find & replace, the link
// dialog) stack instead of overlapping when they're open at the same time. The
// container publishes its DOM node into `dockElement$`; each bar renders through
// `DockedBar`, which portals into it while staying in place in the React tree
// (so realm hooks keep working).

import { addTopAreaChild$, realmPlugin } from "@mdxeditor/editor";
import { Cell, useCellValue, usePublisher } from "@mdxeditor/gurx";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

const dockElement$ = Cell<HTMLElement | null>(null);

function EditorDock() {
	const setDockElement = usePublisher(dockElement$);
	const dockRef = useRef<HTMLDivElement>(null);
	const [isMobile, setIsMobile] = useState(false);
	// The formatting toolbar's live measured size. Its height is what the dock
	// sits flush on top of on mobile; its width — `fit-content`, and so dependent
	// on the button count, when Obsidian's readable line length is on — is what
	// the bars size and centre their content against.
	const [toolbar, setToolbar] = useState<{
		width: number;
		height: number;
	} | null>(null);
	// Whether the on-screen keyboard is up. When it's down we add the bottom
	// safe-area inset so the dock clears the device/app bottom chrome; when it's
	// up the toolbar is glued to the keyboard top and we sit flush against it.
	const [keyboardUp, setKeyboardUp] = useState(false);

	useEffect(() => {
		setDockElement(dockRef.current);
	}, [setDockElement]);

	useEffect(() => {
		const dock = dockRef.current;
		if (!dock) return;
		setIsMobile(!!dock.closest(".rich-text-overlay.is-mobile"));
		const el = dock
			.closest(".mdxeditor")
			?.querySelector<HTMLElement>(".mdxeditor-toolbar");
		if (!el) return;
		const measure = () => {
			const rect = el.getBoundingClientRect();
			setToolbar({ width: rect.width, height: rect.height });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Opening or closing a bar changes the dock's height, which moves the text
	// below it — jarring on its own, and it also drags whatever is under the
	// pointer out from under a right-press. The document can't move if the
	// scroller absorbs the difference, so match every height change with an
	// equal scroll. Runs in the ResizeObserver callback, which fires before
	// paint, so the two never appear out of step.
	//
	// Mobile is exempt: there the dock is fixed above the keyboard and takes no
	// space in flow, so nothing shifts to begin with. And a document shorter
	// than its viewport has no scroll range to spend — that one still shifts.
	useEffect(() => {
		const dock = dockRef.current;
		if (!dock || dock.closest(".rich-text-overlay.is-mobile")) return;

		const editor = dock.closest<HTMLElement>(".mdxeditor");
		if (!editor) return;

		// Resolved per change, not once: which of the two elements carries the
		// overflow depends on the note being long enough to scroll at all.
		// Assigning past either end is clamped by the browser, so a document
		// with only part of the room to give absorbs what it can.
		let height = dock.getBoundingClientRect().height;
		const observer = new ResizeObserver(() => {
			const next = dock.getBoundingClientRect().height;
			const delta = next - height;
			height = next;
			if (delta === 0) return;
			const scroller = [
				editor.querySelector<HTMLElement>(
					".mdxeditor-root-contenteditable",
				),
				editor,
			].find((el) => el && el.scrollHeight > el.clientHeight);
			if (scroller) scroller.scrollTop += delta;
		});
		observer.observe(dock);
		return () => observer.disconnect();
	}, []);

	// Obsidian resizes the layout viewport when the keyboard opens (so
	// visualViewport can't detect it), but the editor's :focus-within state is a
	// reliable proxy: focus in the editor means the keyboard is up and the
	// toolbar is glued to its top — sit flush. When focus leaves, the keyboard is
	// down — add the inset to clear the device/app bottom chrome.
	useEffect(() => {
		const editorEl = dockRef.current?.closest(".mdxeditor");
		if (!editorEl) return;
		const update = () => {
			// Defer so :focus-within settles after focus moves between elements.
			window.setTimeout(() => {
				setKeyboardUp(editorEl.matches(":focus-within"));
			}, 0);
		};
		update();
		activeDocument.addEventListener("focusin", update);
		activeDocument.addEventListener("focusout", update);
		return () => {
			activeDocument.removeEventListener("focusin", update);
			activeDocument.removeEventListener("focusout", update);
		};
	}, []);

	return (
		<div
			ref={dockRef}
			className="rich-text-dock"
			style={
				{
					"--rte-toolbar-width": toolbar ? `${toolbar.width}px` : "none",
					...(isMobile && toolbar
						? {
								bottom: keyboardUp
									? `${toolbar.height}px`
									: `calc(${toolbar.height}px + env(safe-area-inset-bottom))`,
							}
						: {}),
				} as CSSProperties
			}
		/>
	);
}

export function DockedBar(props: {
	className: string;
	children: ReactNode;
	ref?: Ref<HTMLDivElement>;
}) {
	const dock = useCellValue(dockElement$);
	if (!dock) return null;
	return createPortal(
		<div
			ref={props.ref}
			className={`rich-text-docked-bar ${props.className}`}
			// Don't let clicks inside the bar bubble out to the editor's
			// mouse-down link handler / selection logic.
			onMouseDownCapture={(e) => e.stopPropagation()}
		>
			{/* The strip spans the editor; the contents line up with the
			    toolbar above them. */}
			<div className="rich-text-docked-bar-inner">{props.children}</div>
		</div>,
		dock,
	);
}

// Must be added after `toolbarPlugin` so the dock follows the toolbar in the
// editor's top area.
export const editorDockPlugin = realmPlugin({
	init(realm) {
		realm.pub(addTopAreaChild$, EditorDock);
	},
});
