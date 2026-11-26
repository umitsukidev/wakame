import { readFile } from "node:fs/promises";
import { preprocess } from "svelte/compiler";
import type { Plugin } from "vite";
import { createPreprocessor, type WakamePreprocessOptions } from "./internal.js";

/** Run Wakame after ordinary Svelte preprocessing and before compilation. */
export default function wakame<TEntry = string>(options: WakamePreprocessOptions<TEntry>): Plugin {
	return {
		name: "wakame:svelte",
		transform: {
			async handler(code, id) {
				if (!id.endsWith(".svelte")) return;
				const resolved = new Map<string, Promise<string | undefined>>();
				const processor = createPreprocessor(options, (specifier, importer) => {
					let pending = resolved.get(specifier);
					if (!pending) {
						pending = (async () => {
							const result = await this.resolve(specifier, importer);
							if (!result || result.external || !result.id.endsWith(".svelte")) return;
							this.addWatchFile(result.id);
							try {
								return await readFile(result.id, "utf8");
							} catch {
								return;
							}
						})();
						resolved.set(specifier, pending);
					}
					return pending;
				});
				const result = await preprocess(code, processor, { filename: id });
				if (result.code === code) return;
				return { code: result.code, map: result.map ? JSON.stringify(result.map) : null };
			},
		},
	};
}
