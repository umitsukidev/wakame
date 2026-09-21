import type { Dictionary } from "./dictionary.js";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

/** A serializable description of a synchronous tokenizer available at runtime. */
export interface RuntimeTokenizerDescriptor {
	module: string;
	export: string;
	options?: JsonValue;
}

/** The synchronous interface used by generated runtime transforms. */
export interface RuntimeTokenizer {
	segment(text: string): readonly string[];
}

/**
 * Tokenizer implementation supplied by a tokenizer package.
 *
 * The dictionary is always normalized by the core before this method is
 * called, allowing implementations to treat it as a read-only set.
 */
export interface Tokenizer<TToken = string, TEntry = string> {
	tokenize(text: string, dictionary: Dictionary<TEntry>): Promise<readonly TToken[]>;
	runtime?: RuntimeTokenizerDescriptor;
}
