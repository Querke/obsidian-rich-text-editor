# Obsidian plugin submission warnings

Obsidian's plugin review tooling (source code + CSS lint + dependency scan) flags
warnings on this repo. Track known ones here so we don't waste time
re-investigating warnings that are either already fixed or accepted as
unavoidable trade-offs.

**Update this list every time a warning is fixed or a new one appears** —
remove fixed entries, add new ones with the same reasoning format.

## CSS lint — accepted, not fixable without changing behavior

- `display: contents` (`src/mdxeditor.css`: `.rte-blocktype-select`,
  `.callout-title-host`, `.callout-toolbar-icon`) — "only partially supported
  by Obsidian 1.4.5". Required to make these wrapper elements layout-transparent
  (their children need to act as direct flex children of the surrounding
  toolbar/callout). Removing it breaks the layout.
- `text-decoration` multi-value usages (`_underlineStrikethrough_1tncs_38`,
  `.table-formula`) — "only partially supported by Obsidian 1.4.5". Needed for
  combined underline+strikethrough text and the dotted underline on table
  formulas. Single-keyword usages (`underline`, `none`, `line-through`) are not
  flagged, only the multi-value ones.
- `!important` (`src/mdxeditor.css`, mobile link-popover positioning) —
  overrides an inline `transform` style Radix sets at runtime; specificity
  alone can't beat an inline style.
- `:has()` (`src/mdxeditor.css`, same mobile link-popover rule) — scopes the
  `!important` override to just the link popover, not other popups sharing
  `.mdxeditor-popup-container`.

These four are documented inline in `src/mdxeditor.css` with the same
reasoning. Don't "fix" them by deleting the declarations.

## Dependency vulnerabilities

- `diff` (jsdiff DoS in `parsePatch`/`applyPatch`, GHSA-73rr-hh4g-fpgx) —
  fixed via `npm audit fix` (non-breaking, transitive dep of `@mdxeditor/editor`
  via `unidiff`/`uvu`).
- `js-yaml` (quadratic-complexity DoS via merge keys, GHSA-h67p-54hq-rp68) —
  **not fixed**. Only resolvable by upgrading `@mdxeditor/editor` to `4.0.4`,
  which is a breaking major-version change to the plugin's core editor
  dependency. Needs a deliberate upgrade + regression pass, not a drive-by fix.

## Source code warnings

Fixed:
- Unnecessary type assertions in `main.ts` (`editorCheckCallback`/
  `checkCallback` `.call()` results) — removed; the callback types already
  produce `boolean | void` without the `as` assertion.
- `'+' operation on unknown` in `src/RichTextOverlay.tsx` (Notice message
  built from a caught `e`) — narrowed with
  `e instanceof Error ? e.message : String(e)`.
