import {
	loadDefaultJapaneseParser,
	loadDefaultSimplifiedChineseParser,
	loadDefaultThaiParser,
	loadDefaultTraditionalChineseParser,
	type Parser,
} from "budoux";

import type { RuntimeTokenizer } from "@wakamejs/core";

import type { BudouxLanguage } from "./budoux-tokenizer.js";

export interface BudouxRuntimeOptions {
	language?: BudouxLanguage;
}

function isBudouxLanguage(value: string): value is BudouxLanguage {
	return value === "ja" || value === "zh-hans" || value === "zh-hant" || value === "th";
}

function loadParser(language: BudouxLanguage): Pick<Parser, "parse"> {
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

/** Create a synchronous BudouX segmenter for generated runtime JSX transforms. */
export function createBudouxRuntimeTokenizer(options: BudouxRuntimeOptions = {}): RuntimeTokenizer {
	const language = options.language ?? "ja";
	if (!isBudouxLanguage(language)) {
		throw new Error(
			`Unsupported BudouX language "${String(language)}"; expected one of "ja", "zh-hans", "zh-hant", or "th".`,
		);
	}
	const parser = loadParser(language);
	return {
		segment(text) {
			return parser.parse(text);
		},
	};
}
