import type { Dictionary } from "./dictionary.js";

/**
 * Tokenizer implementation supplied by a tokenizer package.
 *
 * The dictionary is always normalized by the core before this method is
 * called, allowing implementations to treat it as a read-only set.
 */
export interface Tokenizer<TToken = string, TEntry = string> {
	tokenize(text: string, dictionary: Dictionary<TEntry>): Promise<readonly TToken[]>;
}
