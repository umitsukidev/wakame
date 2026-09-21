import { describe, expect, test } from "vitest";

import { createBudouxTokenizer } from "../dist/index.js";
import { createBudouxRuntimeTokenizer } from "../dist/runtime.js";

const languageSamples = [
	["ja", "これは日本語の文章です。"],
	["zh-hans", "这是一个用于测试的中文句子。"],
	["zh-hant", "這是一個用於測試的中文句子。"],
	["th", "นี่คือประโยคภาษาไทยสำหรับการทดสอบ"],
] as const;

describe("BudouX tokenizer", () => {
	test.each(languageSamples)(
		"splits and preserves %s text with the built-in parser",
		async (language, text) => {
			const tokenizer = createBudouxTokenizer({ language });
			const tokens = await tokenizer.tokenize(text, new Set());

			expect(tokens.length).toBeGreaterThan(1);
			expect(tokens.join("")).toBe(text);
		},
	);

	test("uses Japanese as the default language", async () => {
		const tokens = await createBudouxTokenizer().tokenize("これは日本語の文章です。", new Set());

		expect(tokens).toEqual(["これは", "日本語の", "文章です。"]);
	});

	test("exposes a runtime descriptor for built-in language models", () => {
		expect(createBudouxTokenizer({ language: "zh-hant" }).runtime).toEqual({
			module: "@wakamejs/budoux/runtime",
			export: "createBudouxRuntimeTokenizer",
			options: { language: "zh-hant" },
		});
		expect(createBudouxTokenizer({ parser: { parse: (text) => [text] } }).runtime).toBeUndefined();
	});

	test("creates a synchronous runtime segmenter", () => {
		const segmenter = createBudouxRuntimeTokenizer({ language: "ja" });
		const text = "これは日本語の文章です。";
		const tokens = segmenter.segment(text);

		expect(tokens.length).toBeGreaterThan(1);
		expect(tokens.join("")).toBe(text);
	});

	test("rejects non-empty runtime dictionaries", () => {
		expect(() => createBudouxRuntimeTokenizer({}, { dictionary: ["固有語"] })).toThrow(
			/does not support custom dictionary entries/,
		);
	});

	test("supports parser injection", async () => {
		const calls: string[] = [];
		const parser = {
			parse(text: string) {
				calls.push(text);
				return [text.slice(0, 2), text.slice(2)];
			},
		};
		const tokenizer = createBudouxTokenizer({ parser });

		expect(await tokenizer.tokenize("保存する文字列", new Set())).toEqual(["保存", "する文字列"]);
		expect(calls).toEqual(["保存する文字列"]);
	});

	test("returns no tokens for empty text", async () => {
		const tokens = await createBudouxTokenizer().tokenize("", new Set());

		expect(tokens).toEqual([]);
	});

	test("rejects non-empty dictionaries explicitly", async () => {
		const tokenizer = createBudouxTokenizer();

		await expect(tokenizer.tokenize("日本語", new Set(["日本語"]))).rejects.toThrow(
			/does not support custom dictionary entries/,
		);
	});

	test("rejects an invalid injected parser", () => {
		expect(() => createBudouxTokenizer({ parser: null } as never)).toThrow(
			/@wakamejs\/budoux requires parser\.parse to be a function/,
		);
	});
});
