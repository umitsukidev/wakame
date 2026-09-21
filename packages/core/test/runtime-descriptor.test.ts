import { describe, expect, test } from "vitest";

import {
	createWakame,
	type RuntimeTokenizerDescriptor,
	type RuntimeTokenizerFactory,
	type Tokenizer,
} from "../dist/index.js";

describe("runtime tokenizer descriptors", () => {
	test("accepts JSON-safe runtime metadata without affecting async tokenization", async () => {
		const runtime: RuntimeTokenizerDescriptor = {
			module: "@example/runtime-tokenizer",
			export: "createTokenizer",
			options: { language: "ja", enabled: true, levels: [1, 2] },
		};
		const tokenizer: Tokenizer<string, string> = {
			runtime,
			async tokenize(text) {
				return [text];
			},
		};

		expect(tokenizer.runtime).toEqual(runtime);
		expect(await createWakame({ tokenizer }).tokenize("日本語")).toEqual(["日本語"]);
	});

	test("defines a runtime factory context for normalized dictionaries", () => {
		const factory: RuntimeTokenizerFactory<{ language: string }> = (options, context) => ({
			segment(text) {
				return options?.language === "ja" && context.dictionary.length === 1 ? [text] : [];
			},
		});

		expect(factory({ language: "ja" }, { dictionary: ["固有語"] }).segment("日本語")).toEqual([
			"日本語",
		]);
	});
});
