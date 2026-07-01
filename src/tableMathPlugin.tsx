// tableMathPlugin.tsx
//
// Spreadsheet-style formulas inside MDXEditor tables, modelled on the
// obsidian-simple-table-math plugin but adapted to MDXEditor's WYSIWYG tables.
//
// A cell whose entire text matches the formula grammar
//
//     [OP][DIR][start:end][currency]
//
//   OP        SUM | AVG | MIN | MAX | SUB | MUL   (case-insensitive)
//   DIR       ^  = the cells above in this column
//             <  = the cells to the left in this row
//   start:end optional 1-based inclusive range (row numbers for `^`, column
//             numbers for `<`, counting from the top/left of the table). When
//             omitted, every cell before the formula in that direction is used.
//   currency  optional trailing symbol/ISO code (e.g. `$`, `€`, `USD`) used to
//             format the result.
//
// e.g.  SUM^   AVG<   SUM^2:4   MUL<   SUM^€
//
// The formula string is what lives in the Markdown cell (table-safe: no pipes,
// no link syntax, round-trips through plain Obsidian and the reference plugin).
// In the editor it is shown as a link-styled chip displaying the computed
// value; clicking the chip opens a small popup to edit or remove the formula.
//
// Why the machinery below looks the way it does: MDXEditor renders a table as a
// single decorator node holding an mdast table, and each cell as its own nested
// Lexical editor that shares the realm's node/visitor registry. So we (a)
// register a TableFormulaNode + export visitor globally, and (b) inject a
// component into every cell editor (addNestedEditorChild$) that scopes a
// TextNode transform to that cell — turning freshly-typed and freshly-imported
// formula text into chips without ever touching body prose outside tables.

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { Notice, Platform } from "obsidian";
import {
	$applyNodeReplacement,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	DecoratorNode,
	TextNode,
} from "lexical";
import type {
	LexicalEditor,
	LexicalNode,
	NodeKey,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import { $dfs } from "@lexical/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	activeEditor$,
	addExportVisitor$,
	addLexicalNode$,
	addNestedEditorChild$,
	ButtonWithTooltip,
	NESTED_EDITOR_UPDATED_COMMAND,
	realmPlugin,
} from "@mdxeditor/editor";
import type { LexicalExportVisitor } from "@mdxeditor/editor";
import { useCellValue } from "@mdxeditor/gurx";
import { LucideIcon } from "./footnotePlugin";

// --------------------------------------------------------------------------
// Formula grammar + evaluation (pure, DOM-agnostic where possible)
// --------------------------------------------------------------------------

type Operation = "SUM" | "AVG" | "MIN" | "MAX" | "SUB" | "MUL";

// Anchored so only a cell whose *entire* content is a formula is matched — a
// cell like "Total: SUM^" is left as plain text.
export const FORMULA_REGEX =
	/^(SUM|AVG|MIN|MAX|SUB|MUL)([\^<])(?:(\d+):(\d+))?\s*(\S*)$/i;

interface ParsedFormula {
	op: Operation;
	dir: "^" | "<";
	rangeStart: number | null;
	rangeEnd: number | null;
	currency: string;
}

export function parseFormula(formula: string): ParsedFormula | null {
	const m = FORMULA_REGEX.exec(formula.trim());
	if (!m) return null;
	return {
		op: m[1].toUpperCase() as Operation,
		dir: m[2] as "^" | "<",
		rangeStart: m[3] ? parseInt(m[3], 10) : null,
		rangeEnd: m[4] ? parseInt(m[4], 10) : null,
		currency: m[5] ?? "",
	};
}

/** Extract a finite number from a cell's rendered text, or null. Strips
 *  currency symbols, thousands separators and stray characters. */
function readNumber(text: string): number | null {
	const cleaned = text.trim().replace(/[^0-9.-]/g, "");
	if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

function evaluate(op: Operation, nums: number[]): number {
	if (nums.length === 0) return op === "MUL" ? 1 : 0;
	switch (op) {
		case "SUM":
			return nums.reduce((a, b) => a + b, 0);
		case "AVG":
			return nums.reduce((a, b) => a + b, 0) / nums.length;
		case "MIN":
			return Math.min(...nums);
		case "MAX":
			return Math.max(...nums);
		case "SUB":
			return nums.reduce((a, b) => a - b);
		case "MUL":
			return nums.reduce((a, b) => a * b, 1);
	}
}

function formatValue(value: number, currency: string): string {
	if (currency && /^[A-Za-z]{3}$/.test(currency)) {
		try {
			return value.toLocaleString(undefined, {
				style: "currency",
				currency: currency.toUpperCase(),
			});
		} catch {
			/* fall through to symbol prefix */
		}
	}
	const num = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	return currency ? currency + num : num;
}

// --------------------------------------------------------------------------
// DOM-based cell gathering
// --------------------------------------------------------------------------
//
// MDXEditor wraps the data grid in tool columns/rows (row/column menu buttons,
// add-row/add-column buttons) that all carry `data-tool-cell`. We index only
// the real data cells so a formula's row/column matches the Markdown table.

function dataCellsOf(row: Element): HTMLTableCellElement[] {
	return Array.from(row.children).filter(
		(el): el is HTMLTableCellElement =>
			(el.tagName === "TD" || el.tagName === "TH") &&
			!el.hasAttribute("data-tool-cell"),
	);
}

/** Computes the display string for a formula chip by reading sibling cells out
 *  of the rendered table. Returns the raw formula if it can't be evaluated. */
function computeDisplay(host: HTMLElement, formula: string): string {
	const parsed = parseFormula(formula);
	if (!parsed) return formula;

	const cell = host.closest("td, th");
	const row = cell?.parentElement;
	const body = row?.parentElement;
	if (!cell || !row || !body) return formula;

	const rows = Array.from(body.children).filter((el) => el.tagName === "TR");
	const rowIndex = rows.indexOf(row);
	const myCells = dataCellsOf(row);
	const colIndex = myCells.indexOf(cell as HTMLTableCellElement);
	if (rowIndex < 0 || colIndex < 0) return formula;

	const withinRange = (i: number, defHi: number): boolean => {
		if (parsed.rangeStart != null && parsed.rangeEnd != null) {
			let lo = parsed.rangeStart - 1;
			let hi = parsed.rangeEnd - 1;
			if (lo > hi) [lo, hi] = [hi, lo];
			return i >= Math.max(0, lo) && i <= hi;
		}
		return i >= 0 && i <= defHi;
	};

	const targets: HTMLTableCellElement[] = [];
	if (parsed.dir === "^") {
		for (let r = 0; r < rows.length; r++) {
			if (r === rowIndex || !withinRange(r, rowIndex - 1)) continue;
			const c = dataCellsOf(rows[r])[colIndex];
			if (c) targets.push(c);
		}
	} else {
		for (let c = 0; c < myCells.length; c++) {
			if (c === colIndex || !withinRange(c, colIndex - 1)) continue;
			targets.push(myCells[c]);
		}
	}

	const nums = targets
		.map((c) => readNumber(c.textContent ?? ""))
		.filter((n): n is number => n !== null);

	return formatValue(evaluate(parsed.op, nums), parsed.currency);
}

// --------------------------------------------------------------------------
// TableFormulaNode — inline decorator chip
// --------------------------------------------------------------------------

type SerializedTableFormulaNode = Spread<
	{ formula: string },
	SerializedLexicalNode
>;

export class TableFormulaNode extends DecoratorNode<ReactElement> {
	__formula: string;

	static getType(): string {
		return "table-formula";
	}

	static clone(node: TableFormulaNode): TableFormulaNode {
		return new TableFormulaNode(node.__formula, node.__key);
	}

	constructor(formula: string, key?: NodeKey) {
		super(key);
		this.__formula = formula;
	}

	getFormula(): string {
		return this.getLatest().__formula;
	}

	setFormula(formula: string): void {
		this.getWritable().__formula = formula;
	}

	createDOM(): HTMLElement {
		const dom = activeDocument.createElement("span");
		dom.className = "table-formula-host";
		return dom;
	}

	updateDOM(): boolean {
		return false;
	}

	isInline(): boolean {
		return true;
	}

	exportJSON(): SerializedTableFormulaNode {
		return { type: "table-formula", version: 1, formula: this.__formula };
	}

	static importJSON(json: SerializedTableFormulaNode): TableFormulaNode {
		return $createTableFormulaNode(json.formula);
	}

	decorate(editor: LexicalEditor): ReactElement {
		return (
			<TableFormulaView
				editor={editor}
				formula={this.__formula}
				nodeKey={this.__key}
			/>
		);
	}
}

export function $createTableFormulaNode(formula: string): TableFormulaNode {
	return $applyNodeReplacement(new TableFormulaNode(formula));
}

export function $isTableFormulaNode(
	node: LexicalNode | null | undefined,
): node is TableFormulaNode {
	return node instanceof TableFormulaNode;
}

// --------------------------------------------------------------------------
// Chip + edit popup React chrome
// --------------------------------------------------------------------------

function TableFormulaView(props: {
	editor: LexicalEditor;
	formula: string;
	nodeKey: NodeKey;
}) {
	const { editor, formula, nodeKey } = props;
	const anchorRef = useRef<HTMLAnchorElement>(null);
	const [display, setDisplay] = useState(formula);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number }>({
		top: 0,
		left: 0,
	});

	// Recompute from the rendered table, and again whenever any cell changes.
	useEffect(() => {
		const host = anchorRef.current;
		if (!host) return;
		const table = host.closest("table");
		if (!table) {
			setDisplay(formula);
			return;
		}
		let raf = 0;
		const recompute = () => {
			window.cancelAnimationFrame(raf);
			raf = window.requestAnimationFrame(() =>
				setDisplay(computeDisplay(host, formula)),
			);
		};
		recompute();
		const observer = new MutationObserver(recompute);
		observer.observe(table, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		return () => {
			observer.disconnect();
			window.cancelAnimationFrame(raf);
		};
	}, [formula]);

	const persist = () =>
		editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);

	const applyFormula = (next: string) => {
		const trimmed = next.trim();
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if (!$isTableFormulaNode(node)) return;
			if (FORMULA_REGEX.test(trimmed)) {
				node.setFormula(trimmed);
			} else {
				node.remove();
			}
		});
		persist();
		setOpen(false);
	};

	const removeFormula = () => {
		editor.update(() => $getNodeByKey(nodeKey)?.remove());
		persist();
		setOpen(false);
	};

	const openPopup = (event: React.MouseEvent) => {
		event.preventDefault();
		const rect = anchorRef.current?.getBoundingClientRect();
		if (rect) {
			// Clamp so the popup never spills off the right edge of the viewport
			// (the chip can sit in a far-right column on a narrow screen).
			const left = Math.max(
				8,
				Math.min(rect.left, window.innerWidth - 288),
			);
			setPos({ top: rect.bottom + 4, left });
		}
		setOpen(true);
	};

	return (
		<>
			<a
				ref={anchorRef}
				className="table-formula"
				href="#"
				title={formula}
				contentEditable={false}
				onMouseDown={(e) => e.preventDefault()}
				onClick={openPopup}
			>
				{display}
			</a>
			{open && (
				<FormulaPopup
					formula={formula}
					pos={pos}
					onApply={applyFormula}
					onRemove={removeFormula}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

function FormulaPopup(props: {
	formula: string;
	pos: { top: number; left: number };
	onApply: (next: string) => void;
	onRemove: () => void;
	onClose: () => void;
}) {
	const [value, setValue] = useState(props.formula);

	// On mobile the on-screen keyboard covers anything anchored to the tapped
	// cell, so dock the popup to the top-centre of the viewport (matching the
	// image dialog). On desktop, anchor it beneath the chip.
	const style: React.CSSProperties = Platform.isMobile
		? { top: 62, left: "50%", transform: "translateX(-50%)" }
		: { top: props.pos.top, left: props.pos.left };

	// Portal to the document body so `position: fixed` is always relative to the
	// viewport, never a transformed table/cell ancestor.
	return createPortal(
		<>
			<div className="table-formula-backdrop" onClick={props.onClose} />
			<div
				className="table-formula-popup"
				style={style}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<input
					className="table-formula-input"
					autoFocus
					value={value}
					spellCheck={false}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") props.onApply(value);
						if (e.key === "Escape") props.onClose();
					}}
				/>
				<button
					type="button"
					className="table-formula-btn"
					onClick={() => props.onApply(value)}
				>
					Apply
				</button>
				<button
					type="button"
					className="table-formula-btn is-danger"
					onClick={props.onRemove}
				>
					Remove
				</button>
			</div>
		</>,
		activeDocument.body,
	);
}

// --------------------------------------------------------------------------
// Per-cell conversion: plain formula text <-> chip
// --------------------------------------------------------------------------

function $maybeConvert(node: TextNode): void {
	if (!node.isAttached()) return;
	const trimmed = node.getTextContent().trim();
	if (!FORMULA_REGEX.test(trimmed)) return;
	node.replace($createTableFormulaNode(trimmed));
}

/**
 * Mounted inside every table cell editor (via addNestedEditorChild$). Converts
 * already-imported formula text to chips on mount and keeps converting as the
 * user types. Being scoped to cell editors is what keeps identical text in body
 * prose untouched.
 */
function TableFormulaCellSync(): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		editor.update(
			() => {
				for (const { node } of $dfs($getRoot())) {
					if (node instanceof TextNode) $maybeConvert(node);
				}
			},
			{ tag: "history-merge" },
		);
		return editor.registerNodeTransform(TextNode, $maybeConvert);
	}, [editor]);
	return null;
}

// --------------------------------------------------------------------------
// Markdown export: chip -> plain formula text
// --------------------------------------------------------------------------

const TableFormulaLexicalVisitor: LexicalExportVisitor<
	TableFormulaNode,
	never
> = {
	testLexicalNode: $isTableFormulaNode,
	visitLexicalNode({ lexicalNode, actions }) {
		actions.addAndStepInto("text", { value: lexicalNode.getFormula() });
	},
};

// --------------------------------------------------------------------------
// Toolbar button
// --------------------------------------------------------------------------

/** Inserts a `SUM^` formula chip into the currently focused table cell. Only
 *  meaningful inside a table, so it no-ops (with a hint) elsewhere. */
export function InsertTableFormula() {
	const editor = useCellValue(activeEditor$);

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		if (!editor) return;
		if (!editor.getRootElement()?.closest("table")) {
			new Notice("Select a table cell first");
			return;
		}
		editor.update(() => {
			const selection = $getSelection();
			const node = $createTableFormulaNode("SUM^");
			if ($isRangeSelection(selection)) {
				selection.insertNodes([node]);
			} else {
				$getRoot().append(node);
			}
		});
		editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
	};

	return (
		<ButtonWithTooltip title="Insert table formula" onClick={handleClick}>
			<LucideIcon name="sigma" />
		</ButtonWithTooltip>
	);
}

// --------------------------------------------------------------------------
// Plugin
// --------------------------------------------------------------------------

export const tableMathPlugin = realmPlugin({
	init(realm) {
		realm.pubIn({
			[addLexicalNode$]: TableFormulaNode,
			[addExportVisitor$]: TableFormulaLexicalVisitor,
			[addNestedEditorChild$]: TableFormulaCellSync,
		});
	},
});
