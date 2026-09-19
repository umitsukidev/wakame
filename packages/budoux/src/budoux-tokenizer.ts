import {
	loadDefaultJapaneseParser,
	loadDefaultSimplifiedChineseParser,
	loadDefaultThaiParser,
	loadDefaultTraditionalChineseParser,
	type Parser,
} from "budoux";

import type { Dictionary, Tokenizer } from "@wakamejs/core";

export type BudouxLanguage = "ja" | "zh-hans" | "zh-hant" | "th";

export type BudouxParser = Pick<Parser, "parse">;

interface DefaultBudouxTokenizerOptions {
	language?: BudouxLanguage;
	parser?: never;
}

interface InjectedBudouxTokenizerOptions {
	parser: BudouxParser;
	language?: never;
}

export type CreateBudouxTokenizerOptions =
	| DefaultBudouxTokenizerOptions
	| InjectedBudouxTokenizerOptions;

function isBudouxLanguage(value: string): value is BudouxLanguage {
	return value === "ja" || value === "zh-hans" || value === "zh-hant" || value === "th";
}

function isBudouxParser(value: unknown): value is BudouxParser {
	return (
		typeof value === "object" &&
		value !== null &&
		"parse" in value &&
		typeof value.parse === "function"
	);
}

function loadParser(language: BudouxLanguage): BudouxParser {
	switch (language) {
		case "ja":
			return loadDefaultJapaneseParser();
		case "zh-hans":
			return loadDefaultSimplifiedChineseParser();
		case "zh-hant":
			return loadDefaultTraditionalChineseParser();
		case "th":
			return loadDefaultThaiParser();
	}
}

/** Create a BudouX tokenizer using one of its built-in language models. */
export function createBudouxTokenizer(
	options?: CreateBudouxTokenizerOptions,
): Tokenizer<string, string> {
	if (options !== undefined && "parser" in options) {
		if (!isBudouxParser(options.parser)) {
			throw new Error("@wakamejs/budoux requires parser.parse to be a function.");
		}
		return createTokenizer(options.parser);
	}

	const language = options?.language ?? "ja";
	if (!isBudouxLanguage(language)) {
		throw new Error(
			`Unsupported BudouX language "${String(language)}"; expected one of "ja", "zh-hans", "zh-hant", or "th".`,
		);
	}

	return createTokenizer(loadParser(language));
}

function createTokenizer(parser: BudouxParser): Tokenizer<string, string> {
	return {
		async tokenize(text: string, dictionary: Dictionary<string>): Promise<readonly string[]> {
			if (dictionary.size > 0) {
				throw new Error(
					"@wakamejs/budoux does not support custom dictionary entries; pass an empty dictionary.",
				);
			}

			return parser.parse(text);
		},
	};
}
