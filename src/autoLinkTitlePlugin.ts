// autoLinkTitlePlugin.ts
//
// When a bare URL is pasted into the editor, fetch the target page's <title>
// and insert a markdown link [Title](url) in place of the raw URL. Mirrors
// the behavior of the obsidian-auto-link-title community plugin, which only
// hooks Obsidian's native CodeMirror editor and therefore does not fire for
// pastes inside MDXEditor.
//
// Behavior:
//   - Selection collapsed + clipboard is a bare URL: insert a link with a
//     "Fetching title…" placeholder, then asynchronously replace the
//     placeholder text once the fetch resolves (or with the URL itself on
//     failure or timeout).
//   - Selection non-empty + clipboard is a bare URL: wrap the selected text
//     as [selected](url). No fetch.
//   - Anything else: fall through to default paste handling.
//
// We attach a capture-phase DOM paste listener on the editor root rather
// than using Lexical's PASTE_COMMAND, because Lexical / MDXEditor have
// multiple paste paths and intercepting only the command leaves a second
// path that re-inserts the raw URL.

import {
	createRootEditorSubscription$,
	realmPlugin,
} from "@mdxeditor/editor";
import {
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
} from "lexical";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { requestUrl } from "obsidian";

const URL_RE = /^https?:\/\/[^\s<>"']+$/i;
const FETCH_TIMEOUT_MS = 8000;

function decodeEntities(s: string): string {
	const doc = new DOMParser().parseFromString(s, "text/html");
	return doc.documentElement.textContent ?? s;
}

function extractTitle(html: string): string | null {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return null;
	const decoded = decodeEntities(match[1]).trim();
	// Strip [ and ] so the rendered markdown stays valid; collapse whitespace.
	const cleaned = decoded.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
	return cleaned.length > 0 ? cleaned : null;
}

async function fetchTitle(url: string): Promise<string | null> {
	const fetcher = (async (): Promise<string | null> => {
		try {
			const res = await requestUrl({
				url,
				method: "GET",
				headers: {
					// Some sites return minimal HTML (or block) without a UA.
					"User-Agent":
						"Mozilla/5.0 (compatible; Obsidian) AppleWebKit/537.36",
				},
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) return null;
			return extractTitle(res.text);
		} catch {
			return null;
		}
	})();

	const timeout = new Promise<null>((resolve) =>
		setTimeout(() => resolve(null), FETCH_TIMEOUT_MS),
	);

	return Promise.race([fetcher, timeout]);
}

export const autoLinkTitlePlugin = realmPlugin({
	init(realm) {
		realm.pub(createRootEditorSubscription$, (editor) => {
			const handlePaste = (event: ClipboardEvent) => {
				const text = event.clipboardData
					?.getData("text/plain")
					?.trim();
				console.log("[autoLinkTitle] paste fired, text=", text);
				if (!text || !URL_RE.test(text)) {
					console.log("[autoLinkTitle] not a bare URL, skipping");
					return;
				}

				// Preempt every other paste path (Lexical commands, MDXEditor,
				// markdown-shortcut autolinking, etc.).
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();

				let placeholderKey: string | null = null;

				editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) {
						console.log(
							"[autoLinkTitle] no range selection, aborting insert",
						);
						return;
					}

					const selected = selection.getTextContent();
					const linkNode = $createLinkNode(text);
					if (selected.length > 0) {
						linkNode.append($createTextNode(selected));
					} else {
						linkNode.append($createTextNode("Fetching title…"));
						placeholderKey = linkNode.getKey();
					}
					selection.insertNodes([linkNode]);
					console.log(
						"[autoLinkTitle] inserted link, key=",
						linkNode.getKey(),
						"selectedText=",
						selected,
					);
				});

				if (placeholderKey === null) return;
				const key = placeholderKey;

				void fetchTitle(text).then((title) => {
					console.log(
						"[autoLinkTitle] fetch resolved, title=",
						title,
					);
					editor.update(
						() => {
							const node = $getNodeByKey(key);
							console.log(
								"[autoLinkTitle] lookup node, isLink=",
								$isLinkNode(node),
								"node=",
								node,
							);
							if (!$isLinkNode(node)) return;
							const display = title ?? text;
							// Append the new text BEFORE removing the old
							// children — otherwise the LinkNode is briefly
							// empty and Lexical's reconciler may prune it.
							const newChild = $createTextNode(display);
							node.append(newChild);
							for (const child of node.getChildren()) {
								if (child.getKey() !== newChild.getKey()) {
									child.remove();
								}
							}
							console.log(
								"[autoLinkTitle] replaced placeholder with",
								display,
							);
						},
						{ tag: "history-merge" },
					);
				});
			};

			// The root element can change (e.g. on remount). Re-bind on each
			// change and clean up the previous binding.
			let detach: (() => void) | null = null;
			const unregisterRoot = editor.registerRootListener((rootEl) => {
				if (detach) {
					detach();
					detach = null;
				}
				if (rootEl) {
					rootEl.addEventListener("paste", handlePaste, {
						capture: true,
					});
					detach = () =>
						rootEl.removeEventListener("paste", handlePaste, {
							capture: true,
						});
				}
			});

			return () => {
				unregisterRoot();
				if (detach) detach();
			};
		});
	},
});
