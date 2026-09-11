import assert from "node:assert/strict";
import test from "node:test";

import { createBudouxTokenizer } from "../dist/index.js";

const languageSamples = new Map([
	["ja", "これは日本語の文章です。"],
	["zh-hans", "这是一个用于测试的中文句子。"],
	["zh-hant", "這是一個用於測試的中文句子。"],
	["th", "นี่คือประโยคภาษาไทยสำหรับการทดสอบ"],
]);

for (const [language, text] of languageSamples) {
	await test(`splits and preserves ${language} text with the built-in parser`, async () => {
		const tokenizer = createBudouxTokenizer({ language });
		const tokens = await tokenizer.tokenize(text, new Set());

		assert.ok(tokens.length > 1);
		assert.equal(tokens.join(""), text);
	});
}

await test("uses Japanese as the default language", async () => {
	const text = languageSamples.get("ja");
	assert.ok(text);

	const tokens = await createBudouxTokenizer().tokenize(text, new Set());

	assert.deepEqual(tokens, ["これは", "日本語の", "文章です。"]);
});

await test("supports parser injection", async () => {
	const calls = [];
	const parser = {
		parse(text) {
			calls.push(text);
			return [text.slice(0, 2), text.slice(2)];
		},
	};
	const tokenizer = createBudouxTokenizer({ parser });

	assert.deepEqual(await tokenizer.tokenize("保存する文字列", new Set()), ["保存", "する文字列"]);
	assert.deepEqual(calls, ["保存する文字列"]);
});

await test("returns no tokens for empty text", async () => {
	const tokens = await createBudouxTokenizer().tokenize("", new Set());

	assert.deepEqual(tokens, []);
});

await test("rejects non-empty dictionaries explicitly", async () => {
	const tokenizer = createBudouxTokenizer();

	await assert.rejects(
		tokenizer.tokenize("日本語", new Set(["日本語"])),
		/does not support custom dictionary entries/,
	);
});

await test("rejects an invalid injected parser", () => {
	assert.throws(
		() => createBudouxTokenizer({ parser: null }),
		/@wakamejs\/budoux requires parser\.parse to be a function/,
	);
});
