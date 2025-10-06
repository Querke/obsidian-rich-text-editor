// // ExampleView.tsx
// import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
// import { StrictMode } from "react";
// import { Root, createRoot } from "react-dom/client";
// import { ReactView } from "./ReactView";

// export const VIEW_TYPE_EXAMPLE = "example-view";

// export class ExampleView extends ItemView {
// 	root: Root | null = null;
// 	fileText: string = "";

// 	constructor(leaf: WorkspaceLeaf) {
// 		super(leaf);
// 	}

// 	getViewType(): string {
// 		return VIEW_TYPE_EXAMPLE;
// 	}

// 	getDisplayText(): string {
// 		return "Example view";
// 	}

// 	async onOpen(): Promise<void> {
// 		// read the currently active file
// 		const file = this.app.workspace.getActiveFile();
// 		if (file instanceof TFile) {
// 			this.fileText = await this.app.vault.read(file);
// 		}

// 		// define save handler
// 		const handleSave = async (newText: string) => {
// 			const file = this.app.workspace.getActiveFile();
// 			if (file instanceof TFile) {
// 				await this.app.vault.modify(file, newText);
// 			}
// 		};

// 		// mount React
// 		this.root = createRoot(this.contentEl);
// 		this.root.render(
// 			<StrictMode>
// 				<ReactView text={this.fileText} onSave={handleSave} />
// 			</StrictMode>
// 		);
// 	}

// 	async onClose(): Promise<void> {
// 		this.root?.unmount();
// 	}
// }
