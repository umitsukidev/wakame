import type { Dictionary, DictionaryInput } from "./dictionary.js";
import type { Tokenizer } from "./tokenizer.js";

export interface CreateWakameOptions<TToken = string, TEntry = string> {
	tokenizer: Tokenizer<TToken, TEntry>;
	dictionary?: DictionaryInput<TEntry>;
}

export interface Wakame<TToken = string> {
	tokenize(text: string): Promise<readonly TToken[]>;
}

export function createWakame<TToken = string, TEntry = string>(
	options: CreateWakameOptions<TToken, TEntry>,
): Wakame<TToken> {
	const tokenizer = options.tokenizer;
	const dictionary: Dictionary<TEntry> = new Set(options.dictionary ?? []);

	return {
		tokenize(text) {
			return tokenizer.tokenize(text, dictionary);
		},
	};
}
