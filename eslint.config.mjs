// eslint.config.mjs
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: ["node_modules/", "main.js", "**/*.json", "**/*.mjs"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs"],
		rules: {
			"obsidianmd/no-plugin-as-component": "off",
			"obsidianmd/no-unsupported-api": "off",
			"obsidianmd/no-view-references-in-plugin": "off",
			"obsidianmd/prefer-file-manager-trash-file": "off",
			"obsidianmd/prefer-instanceof": "off",
		},
	},
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parserOptions: { project: "./tsconfig.json" },
		},

		// You can add your own configuration to override or add rules
		rules: {
			// example: turn off a rule from the recommended set
			"obsidianmd/sample-names": "off",
			// example: add a rule not in the recommended set and set its severity
			"obsidianmd/prefer-file-manager-trash-file": "error",
			// TypeScript already reports undefined identifiers, and it
			// understands ambient globals like the `React` type namespace
			// (`export as namespace React`) that `no-undef` cannot see.
			"no-undef": "off",
			// We alias `this` to `plugin` when patching Obsidian command
			// prototypes, where the replacement `function` needs its own
			// runtime `this` for the original `.call(this, …)`.
			"@typescript-eslint/no-this-alias": [
				"error",
				{ allowDestructuring: true, allowedNames: ["plugin"] },
			],
		},
	},
]);
