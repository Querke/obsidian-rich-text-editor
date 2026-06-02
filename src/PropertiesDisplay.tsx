import { setIcon } from "obsidian";
import { useEffect, useRef, useState } from "react";

export interface PropertyInfo {
	key: string;
	value: unknown;
	type: string;
}

const TYPE_ICONS: Record<string, string> = {
	text: "text",
	number: "binary",
	checkbox: "check-square",
	date: "calendar",
	datetime: "clock",
	tags: "tags",
	aliases: "forward",
	multitext: "list",
};

// Frontmatter values are `unknown` (strings, numbers, booleans, or arrays of
// those in normal use). Stringify primitives directly; fall back to JSON for
// the rare nested object so we never render the useless "[object Object]".
function toDisplayString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	// Objects/arrays (and the rare symbol/function): JSON instead of the
	// useless "[object Object]". JSON.stringify can return undefined.
	return JSON.stringify(value) ?? "";
}

function ObsidianIcon({ name, className }: { name: string; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} className={className} />;
}

function PropertyValue({ prop }: { prop: PropertyInfo }) {
	const { value, type } = prop;

	if (type === "checkbox") {
		return (
			<input
				className="metadata-input-checkbox"
				type="checkbox"
				checked={!!value}
				disabled
				readOnly
			/>
		);
	}

	if (type === "tags" || type === "aliases" || type === "multitext") {
		const items = Array.isArray(value)
			? value.map(toDisplayString)
			: value
				? [toDisplayString(value)]
				: [];
		if (items.length === 0) {
			return (
				<span className="metadata-input-longtext metadata-value-empty">
					Empty
				</span>
			);
		}
		return (
			<div className="multi-select-container">
				{items.map((item, i) => (
					<div className="multi-select-pill" key={i}>
						<div className="multi-select-pill-content">
							{item}
						</div>
					</div>
				))}
			</div>
		);
	}

	if (type === "date" || type === "datetime") {
		const display = value ? toDisplayString(value) : "";
		if (!display) {
			return (
				<span className="metadata-input metadata-input-text metadata-value-empty">
					Empty
				</span>
			);
		}
		return (
			<span className="metadata-input metadata-input-text">
				{display}
			</span>
		);
	}

	if (type === "number") {
		if (value === null || value === undefined || value === "") {
			return (
				<span className="metadata-input metadata-input-number metadata-value-empty">
					Empty
				</span>
			);
		}
		return (
			<span className="metadata-input metadata-input-number">
				{toDisplayString(value)}
			</span>
		);
	}

	// Default: text
	const textVal = value ? toDisplayString(value) : "";
	if (!textVal) {
		return (
			<div className="metadata-input-longtext metadata-value-empty">
				Empty
			</div>
		);
	}
	return <div className="metadata-input-longtext">{textVal}</div>;
}

export function PropertiesDisplay({
	properties,
}: {
	properties: PropertyInfo[];
}) {
	const [collapsed, setCollapsed] = useState(false);
	const collapseRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (collapseRef.current) setIcon(collapseRef.current, "right-triangle");
	}, []);

	if (properties.length === 0) return null;

	return (
		<div
			className="metadata-container"
			data-property-count={properties.length}
		>
			<div
				className="metadata-properties-heading"
				onClick={() => setCollapsed((c) => !c)}
			>
				<div
					ref={collapseRef}
					className={`collapse-indicator collapse-icon${collapsed ? " is-collapsed" : ""}`}
				/>
				<div className="metadata-properties-title">Properties</div>
			</div>
			{!collapsed && (
				<div className="metadata-content">
					<div className="metadata-properties">
						{properties.map((prop) => (
							<div
								className="metadata-property"
								key={prop.key}
								data-property-key={prop.key}
							>
								<div className="metadata-property-key">
									<ObsidianIcon
										name={
											TYPE_ICONS[prop.type] || "text"
										}
										className="metadata-property-icon"
									/>
									<span className="metadata-property-key-input">
										{prop.key}
									</span>
								</div>
								<div
									className="metadata-property-value"
									data-property-type={prop.type}
								>
									<PropertyValue prop={prop} />
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
