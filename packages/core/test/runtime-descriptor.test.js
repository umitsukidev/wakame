import { describe, expect, test } from "vitest";
import { createWakame } from "../dist/index.js";
describe("runtime tokenizer descriptors", () => {
	test("accepts JSON-safe runtime metadata without affecting async tokenization", async () => {
		const runtime = {
			module: "@example/runtime-tokenizer",
			export: "createTokenizer",
			options: { language: "ja", enabled: true, levels: [1, 2] },
		};
		const tokenizer = {
			runtime,
			async tokenize(text) {
				return [text];
			},
		};
		expect(tokenizer.runtime).toEqual(runtime);
		expect(await createWakame({ tokenizer }).tokenize("日本語")).toEqual(["日本語"]);
	});
});
//# sourceMappingURL=runtime-descriptor.test.js.map
