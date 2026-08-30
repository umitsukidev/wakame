import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Wakame } from "@wakamejs/core";
import { transformHtml } from "@wakamejs/vite";

export async function transformHtmlFiles(
	directory: URL,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) {
			await transformHtmlFiles(
				new URL(`${encodeURIComponent(entry.name)}/`, directory),
				wakame,
				shouldApplyWrapStyle,
			);
			continue;
		}
		if (!entry.isFile() || !entry.name.endsWith(".html")) continue;

		const path = fileURLToPath(new URL(encodeURIComponent(entry.name), directory));
		const source = await readFile(path, "utf8");
		// Recompute breaks when Astro processes HTML produced by an earlier run.
		const transformed = await transformHtml(source, wakame, shouldApplyWrapStyle, {
			preserveExistingWbr: false,
		});
		if (transformed !== source) await writeFile(path, transformed, "utf8");
	}
}
