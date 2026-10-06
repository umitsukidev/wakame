import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Wakame } from "@wakamejs/core";
import { transformHtml } from "@wakamejs/vite";

async function collectHtmlFilePaths(directory: URL, paths: string[]): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.isDirectory()) {
			await collectHtmlFilePaths(new URL(`${encodeURIComponent(entry.name)}/`, directory), paths);
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".html")) {
			paths.push(fileURLToPath(new URL(encodeURIComponent(entry.name), directory)));
		}
	}
}

async function transformHtmlFile(
	path: string,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
): Promise<void> {
	const source = await readFile(path, "utf8");
	// Recompute breaks when Astro processes HTML produced by an earlier run.
	const transformed = await transformHtml(source, wakame, shouldApplyWrapStyle, {
		preserveExistingWbr: false,
	});
	if (transformed !== source) await writeFile(path, transformed, "utf8");
}

export async function transformHtmlFiles(
	directory: URL,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
	buildConcurrency: number,
): Promise<void> {
	const paths: string[] = [];
	await collectHtmlFilePaths(directory, paths);

	const pathIterator = paths.values();
	let failure: { error: unknown } | undefined;
	const runWorker = async (): Promise<void> => {
		while (failure === undefined) {
			const next = pathIterator.next();
			if (next.done) return;
			try {
				await transformHtmlFile(next.value, wakame, shouldApplyWrapStyle);
			} catch (error) {
				failure = { error };
				return;
			}
		}
	};

	const workerCount = Math.min(buildConcurrency, paths.length);
	await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	if (failure !== undefined) throw failure.error;
}
