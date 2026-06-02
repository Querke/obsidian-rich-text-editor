// Find & replace bar for the rich-text editor.
//
// MDXEditor ships an (undocumented) `searchPlugin` + `useEditorSearch` hook
// that does the heavy lifting: it indexes the editor's text nodes, runs the
// query as a case-insensitive regex, highlights matches via the CSS Custom
// Highlight API (the `MdxSearch` / `MdxFocusSearch` highlights), and exposes
// next/prev/replace/replaceAll. It does NOT ship any UI — this file is that UI.
//
// The bar is injected as an MDXEditor top-area child (see `searchBarPlugin`
// below) so it lives inside the editor's realm and `useEditorSearch` works.
// It is opened by the `plugin:open-search` event that RichTextOverlay fires on
// Ctrl/Cmd+F (find) and Ctrl/Cmd+H (replace).
//
// Replace is reimplemented here via TextNode.spliceText rather than the hook's
// replace/replaceAll, which crash when a match sits inside a link node.

import { useEffect, useRef, useState } from "react";
import {
	addTopAreaChild$,
	editorSearchCursor$,
	realmPlugin,
	useEditorSearch,
} from "@mdxeditor/editor";
import { useRealm } from "@mdxeditor/gurx";
import {
	$createRangeSelection,
	$getNearestNodeFromDOMNode,
	$isTextNode,
	getNearestEditorFromDOMNode,
} from "lexical";

const ChevronUp = () => (
	<svg
		viewBox="0 0 24 24"
		width="16"
		height="16"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="m18 15-6-6-6 6" />
	</svg>
);
const ChevronDown = () => (
	<svg
		viewBox="0 0 24 24"
		width="16"
		height="16"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="m6 9 6 6 6-6" />
	</svg>
);
const CloseIcon = () => (
	<svg
		viewBox="0 0 24 24"
		width="16"
		height="16"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M18 6 6 18M6 6l12 12" />
	</svg>
);
// Lucide "replace" — two cards with an arrow flowing from one to the other.
const ReplaceIcon = () => (
	<svg
		viewBox="0 0 24 24"
		width="16"
		height="16"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<rect x="3" y="3" width="8" height="8" rx="2" />
		<path d="M7 11v4a2 2 0 0 0 2 2h4" />
		<rect x="13" y="13" width="8" height="8" rx="2" />
	</svg>
);

export function SearchBar() {
	const {
		isSearchOpen,
		openSearch,
		closeSearch,
		setSearch,
		total,
		cursor,
		next,
		prev,
		ranges,
		currentRange,
	} = useEditorSearch();
	const realm = useRealm();

	const [term, setTerm] = useState("");
	const [replacement, setReplacement] = useState("");
	const [showReplace, setShowReplace] = useState(false);
	// On mobile the bar is pinned to the bottom, sitting directly above the
	// formatting toolbar — this is the toolbar's measured height (px).
	const [toolbarOffset, setToolbarOffset] = useState<number | null>(null);
	// Whether the on-screen keyboard is up. When it's down we add the bottom
	// safe-area inset so the bar clears the device/app bottom chrome; when it's
	// up the toolbar is glued to the keyboard top and we sit flush against it.
	const [keyboardUp, setKeyboardUp] = useState(false);

	const barRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const replaceInputRef = useRef<HTMLInputElement>(null);

	// Open via the Ctrl/Cmd+F (find) and Ctrl/Cmd+H (replace) events dispatched
	// from RichTextOverlay's scope.
	useEffect(() => {
		const onOpen = (e: Event) => {
			const wantsReplace = !!(e as CustomEvent<{ replace?: boolean }>)
				.detail?.replace;
			// Set explicitly (not just on true) so "Find" opens find-only mode
			// even if replace was previously shown.
			setShowReplace(wantsReplace);
			openSearch();
		};
		activeDocument.addEventListener("plugin:open-search", onOpen);
		return () =>
			activeDocument.removeEventListener("plugin:open-search", onOpen);
	}, [openSearch]);

	// When the bar becomes visible, focus the input and (re)apply the current
	// term so highlights come back if it was closed with a query still typed.
	useEffect(() => {
		if (!isSearchOpen) return;
		searchInputRef.current?.focus();
		searchInputRef.current?.select();
		if (term) setSearch(term);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isSearchOpen]);

	// Escape closes the bar from anywhere inside the editor — including when
	// focus is in the document (e.g. right after a replace) rather than in the
	// search inputs. Scoped to this overlay so it doesn't hijack Escape globally.
	useEffect(() => {
		if (!isSearchOpen) return;
		const container =
			barRef.current?.closest(".rich-text-overlay") ??
			barRef.current?.closest(".react-root") ??
			null;
		if (!container) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			setSearch("");
			closeSearch();
		};
		container.addEventListener("keydown", onKeyDown, true);
		return () =>
			container.removeEventListener("keydown", onKeyDown, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isSearchOpen]);

	// On mobile, keep the bar sitting just above the formatting toolbar by
	// tracking the toolbar's live height (it can grow to two rows). On desktop
	// the bar is in-flow at the top, so no offset is needed.
	useEffect(() => {
		if (!isSearchOpen) {
			setToolbarOffset(null);
			return;
		}
		const bar = barRef.current;
		const isMobile = !!bar?.closest(".rich-text-overlay.is-mobile");
		if (!bar || !isMobile) {
			setToolbarOffset(null);
			return;
		}
		const toolbar = bar
			.closest(".mdxeditor")
			?.querySelector<HTMLElement>(".mdxeditor-toolbar");
		if (!toolbar) return;
		const measure = () =>
			setToolbarOffset(toolbar.getBoundingClientRect().height);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(toolbar);
		return () => observer.disconnect();
	}, [isSearchOpen]);

	// Decide when to add the bottom safe-area inset. Obsidian resizes the layout
	// viewport when the keyboard opens (so visualViewport can't detect it), but
	// the editor's :focus-within state is a reliable proxy: focus in the editor
	// means the keyboard is up and the toolbar is glued to its top — sit flush.
	// When focus leaves, the keyboard is down — add the inset to clear the
	// device/app bottom chrome.
	useEffect(() => {
		if (!isSearchOpen) return;
		const editorEl = barRef.current?.closest(".mdxeditor");
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
	}, [isSearchOpen]);

	if (!isSearchOpen) return null;

	const handleClose = () => {
		setSearch("");
		closeSearch();
	};

	const onTermChange = (value: string) => {
		setTerm(value);
		setSearch(value);
	};

	// Replace the text covered by a single match range.
	//
	// MDXEditor's own replace builds a RangeSelection from DOM offsets and calls
	// insertText. When a match sits at the end of a text node inside a link,
	// insertText splits that node mid-operation and the (still valid at entry)
	// focus offset ends up past the shortened node, crashing Lexical with
	// "$getTextNodeOffset: invalid offset N for size M". We instead mutate the
	// text node directly via spliceText, which never trips that path.
	const spliceMatch = (range: Range, str: string) => {
		const startNode = $getNearestNodeFromDOMNode(range.startContainer);
		const endNode = $getNearestNodeFromDOMNode(range.endContainer);
		if (!$isTextNode(startNode) || !$isTextNode(endNode)) return;

		if (startNode.is(endNode)) {
			const size = startNode.getTextContentSize();
			const start = Math.min(range.startOffset, size);
			const end = Math.min(range.endOffset, size);
			if (end > start) startNode.spliceText(start, end - start, str, false);
			return;
		}

		// Match spanning two text nodes — clamp offsets and fall back to a
		// range selection (this path doesn't hit the link edge case above).
		const selection = $createRangeSelection();
		selection.anchor.set(
			startNode.getKey(),
			Math.min(range.startOffset, startNode.getTextContentSize()),
			"text",
		);
		selection.focus.set(
			endNode.getKey(),
			Math.min(range.endOffset, endNode.getTextContentSize()),
			"text",
		);
		selection.insertText(str);
	};

	// After mutating the text the searchPlugin re-indexes and re-highlights.
	// Reset the cursor first so that recompute can't dereference a match index
	// that no longer exists (it would otherwise throw).
	const resetCursor = () => realm.pub(editorSearchCursor$, 0);

	const replaceCurrent = (str: string) => {
		if (!term || !currentRange) return;
		const editor = getNearestEditorFromDOMNode(currentRange.startContainer);
		if (!editor) return;
		// Lexical reconciles its selection (and focuses the contenteditable)
		// after the edit, stealing focus from the replace input. Pull it back —
		// both right after the commit and on the next tick — so the user can keep
		// pressing Enter to replace successive matches.
		const restoreFocus = () => replaceInputRef.current?.focus();
		editor.update(() => spliceMatch(currentRange, str), {
			onUpdate: restoreFocus,
		});
		resetCursor();
		window.setTimeout(restoreFocus, 0);
	};

	const replaceAllMatches = (str: string) => {
		if (!term || ranges.length === 0) return;
		const editor = getNearestEditorFromDOMNode(ranges[0].startContainer);
		if (!editor) return;
		editor.update(() => {
			// Reverse document order so earlier offsets stay valid as later
			// matches in the same node are spliced out first.
			for (let i = ranges.length - 1; i >= 0; i--) {
				spliceMatch(ranges[i], str);
			}
		});
		resetCursor();
	};

	const focusInput = (ref: React.RefObject<HTMLInputElement | null>) => {
		ref.current?.focus();
		ref.current?.select();
	};

	const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			handleClose();
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (e.shiftKey) prev();
			else next();
		} else if (e.key === "Tab" && showReplace) {
			// Move focus into the replace field instead of tabbing to buttons.
			e.preventDefault();
			focusInput(replaceInputRef);
		}
	};

	const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			handleClose();
		} else if (e.key === "Enter") {
			e.preventDefault();
			replaceCurrent(replacement);
		} else if (e.key === "Tab") {
			// Cycle back to the find field.
			e.preventDefault();
			focusInput(searchInputRef);
		}
	};

	const matchLabel =
		total > 0 ? `${cursor || 1}/${total}` : term ? "0/0" : "";

	return (
		<div
			ref={barRef}
			className="rich-text-search-bar"
			style={
				toolbarOffset != null
					? {
							// Sit flush above the toolbar. When the keyboard is
							// down, add the bottom safe-area inset so the bar isn't
							// swallowed by the device/app bottom chrome.
							bottom: keyboardUp
								? `${toolbarOffset}px`
								: `calc(${toolbarOffset}px + env(safe-area-inset-bottom))`,
						}
					: undefined
			}
			// Don't let clicks inside the bar bubble out to the editor's
			// mouse-down link handler / selection logic.
			onMouseDownCapture={(e) => e.stopPropagation()}
		>
			<button
				className={
					"clickable-icon rich-text-search-toggle" +
					(showReplace ? " is-active" : "")
				}
				aria-label={showReplace ? "Hide replace" : "Show replace"}
				onClick={() => setShowReplace((v) => !v)}
			>
				<ReplaceIcon />
			</button>

			<div className="rich-text-search-fields">
				<input
					ref={searchInputRef}
					className="rich-text-search-input"
					type="text"
					placeholder="Find"
					value={term}
					onChange={(e) => onTermChange(e.target.value)}
					onKeyDown={handleSearchKeyDown}
				/>
				<div className="rich-text-search-actions">
					<span className="rich-text-search-count">{matchLabel}</span>
					<button
						className="clickable-icon"
						aria-label="Previous match"
						disabled={total === 0}
						onClick={() => prev()}
					>
						<ChevronUp />
					</button>
					<button
						className="clickable-icon"
						aria-label="Next match"
						disabled={total === 0}
						onClick={() => next()}
					>
						<ChevronDown />
					</button>
					<button
						className="clickable-icon"
						aria-label="Close"
						onClick={handleClose}
					>
						<CloseIcon />
					</button>
				</div>

				{showReplace && (
					<>
						<input
							ref={replaceInputRef}
							className="rich-text-search-input"
							type="text"
							placeholder="Replace"
							value={replacement}
							onChange={(e) => setReplacement(e.target.value)}
							onKeyDown={handleReplaceKeyDown}
						/>
						<div className="rich-text-search-actions">
							<button
								className="rich-text-search-btn"
								disabled={total === 0}
								onClick={() => replaceCurrent(replacement)}
							>
								Replace
							</button>
							<button
								className="rich-text-search-btn"
								disabled={total === 0}
								onClick={() => replaceAllMatches(replacement)}
							>
								Replace all
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// Injects the search bar into the editor's top area so it renders inside the
// MDXEditor realm (required for `useEditorSearch`) and sits, in normal flow,
// just below the formatting toolbar on desktop (and at the very top on mobile,
// where the toolbar is moved to the bottom). Add alongside `searchPlugin()` in
// the editor's plugin list.
export const searchBarPlugin = realmPlugin({
	init(realm) {
		realm.pub(addTopAreaChild$, SearchBar);
	},
});
