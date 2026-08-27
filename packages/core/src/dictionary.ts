/** A normalized dictionary passed to tokenizer implementations. */
export type Dictionary<TEntry = string> = ReadonlySet<TEntry>;

/** Values accepted when configuring a dictionary. */
export type DictionaryInput<TEntry = string> = Iterable<TEntry>;
