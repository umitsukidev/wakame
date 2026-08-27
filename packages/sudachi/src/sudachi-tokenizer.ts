import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Dictionary, Tokenizer } from "@wakamejs/core";

interface NativeTokenizer {
	tokenize(text: string): Promise<readonly string[]>;
}

interface NativeBindingModule {
	SudachiTokenizer: new (systemDictionaryPath: string) => NativeTokenizer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNativeBinding(value: unknown): NativeBindingModule | undefined {
	if (!isRecord(value) || typeof value.SudachiTokenizer !== "function") {
		return undefined;
	}

	return value as unknown as NativeBindingModule;
}

async function loadNativeBinding(): Promise<NativeBindingModule> {
	const nativeBindingUrl = new URL("../generated/native-binding.js", import.meta.url);

	let namespace: unknown;
	try {
		namespace = await import(nativeBindingUrl.href);
	} catch (cause) {
		throw new Error(
			`Unable to load the Sudachi native binding at ${nativeBindingUrl.href}. Build @wakamejs/sudachi before using it.`,
			{ cause },
		);
	}

	const moduleNamespace = isRecord(namespace) ? namespace : undefined;
	const module = getNativeBinding(moduleNamespace?.default) ?? getNativeBinding(namespace);
	if (module === undefined) {
		throw new Error(
			`The Sudachi native binding at ${nativeBindingUrl.href} does not export SudachiTokenizer.`,
		);
	}

	return module;
}

async function resolveSystemDictionaryPath(): Promise<string> {
	const dictionaryUrl = new URL("../assets/system.dic", import.meta.url);
	const dictionaryPath = fileURLToPath(dictionaryUrl);

	try {
		await access(dictionaryUrl);
	} catch (cause) {
		throw new Error(
			`@wakamejs/sudachi requires a Sudachi system dictionary at ${dictionaryPath}. The dictionary asset is not bundled yet.`,
			{ cause },
		);
	}

	return dictionaryPath;
}

/** Create a Node.js Sudachi tokenizer backed by the bundled system dictionary. */
export async function createSudachiTokenizer(): Promise<Tokenizer<string, string>> {
	const [systemDictionaryPath, nativeBinding] = await Promise.all([
		resolveSystemDictionaryPath(),
		loadNativeBinding(),
	]);
	const tokenizer = new nativeBinding.SudachiTokenizer(systemDictionaryPath);

	return {
		async tokenize(text: string, dictionary: Dictionary<string>): Promise<readonly string[]> {
			if (dictionary.size > 0) {
				throw new Error(
					"@wakamejs/sudachi does not support custom dictionary entries yet; pass an empty dictionary.",
				);
			}

			return tokenizer.tokenize(text);
		},
	};
}
