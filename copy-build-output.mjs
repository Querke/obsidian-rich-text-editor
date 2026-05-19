import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const targetDirectory = "C:\\Obsidian\\.obsidian\\plugins\\rich-text-editor";
const outputFiles = ["main.js", "styles.css", "manifest.json"];

mkdirSync(targetDirectory, { recursive: true });

for (const outputFile of outputFiles) {
	const sourcePath = join(sourceDirectory, outputFile);
	const targetPath = join(targetDirectory, outputFile);

	if (!existsSync(sourcePath)) {
		throw new Error(`build output "${outputFile}" does not exist`);
	}

	if (resolve(sourcePath) === resolve(targetPath)) {
		continue;
	}

	copyFileSync(sourcePath, targetPath);
}
