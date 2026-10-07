import { readFile } from "node:fs/promises";
import { createWakame, type DictionaryInput, type Tokenizer, type Wakame } from "@wakamejs/core";
import initWasm, { HtmlDocument as WasmHtmlDocument } from "../generated/html_wasm.js";
import type { Plugin } from "vite";

let wasmInitialization: Promise<void> | undefined;

function initializeWasm(): Promise<void> {
	if (!wasmInitialization) {
		wasmInitialization = readFile(new URL("../generated/html_wasm_bg.wasm", import.meta.url))
			.then((wasm) => initWasm({ module_or_path: wasm }))
			.then(() => undefined)
			.catch((error: unknown) => {
				wasmInitialization = undefined;
				throw error;
			});
	}
	return wasmInitialization;
}

function tokenBoundaries(text: string, tokens: readonly string[]): number[] {
	const boundaries: number[] = [];
	let offset = 0;
	for (const token of tokens) {
		if (token.length === 0) continue;
		offset += token.length;
		if (offset < text.length) boundaries.push(offset);
	}
	return boundaries;
}

export interface WakamePluginOptions {
	tokenizer: Tokenizer<string>;
	dictionary?: DictionaryInput;
	applyWrapStyle?: boolean;
}

export type CreateWakamePluginOptions = WakamePluginOptions;

export type WakamePlugin = Plugin;

export interface TransformHtmlOptions {
	/**
	 * Keep `<wbr>` elements already present in the input HTML. Set this to false
	 * when the caller owns the generated HTML and wants to recompute all breaks.
	 */
	preserveExistingWbr?: boolean;
}

/** Process one HTML document with the same semantic contexts as BudouX. */
export async function transformHtml(
	html: string,
	wakame: Wakame<string>,
	shouldApplyWrapStyle = true,
	options: TransformHtmlOptions = {},
): Promise<string> {
	if (html === "") return html;

	await initializeWasm();
	const document = new WasmHtmlDocument(html, options.preserveExistingWbr !== false);
	try {
		const paragraphs = Array.from(document.paragraphs()) as string[];
		const pendingBreaks: { paragraphIndex: number; boundaries: number[] }[] = [];

		for (const [paragraphIndex, text] of paragraphs.entries()) {
			if (!document.paragraph_can_split(paragraphIndex) || /^\s*$/.test(text)) continue;

			const tokens = await wakame.tokenize(text);
			const restored = tokens.join("");
			if (restored !== text) {
				throw new Error(
					`Wakame tokenizer output does not reconstruct the paragraph text (expected ${JSON.stringify(text)}, received ${JSON.stringify(restored)})`,
				);
			}

			const boundaries = tokenBoundaries(text, tokens);
			if (boundaries.length > 0) pendingBreaks.push({ paragraphIndex, boundaries });
		}

		for (const { paragraphIndex, boundaries } of pendingBreaks.reverse()) {
			document.apply_breaks(paragraphIndex, Uint32Array.from(boundaries), shouldApplyWrapStyle);
		}

		return document.serialize();
	} finally {
		document.free();
	}
}

/** Create a Vite post transformIndexHtml plugin for Wakame. */
function wakamePlugin(options: WakamePluginOptions): WakamePlugin {
	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary: options.dictionary ?? [],
	});

	return {
		name: "wakame",
		transformIndexHtml: {
			order: "post",
			async handler(html) {
				return transformHtml(html, wakame, options.applyWrapStyle ?? true);
			},
		},
	};
}

export default wakamePlugin;
