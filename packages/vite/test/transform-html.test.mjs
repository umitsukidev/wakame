import assert from "node:assert/strict";
import test from "node:test";

import { transformHtml } from "../dist/index.js";

function createWakame(tokenize = (text) => [...text]) {
	const calls = [];
	return {
		calls,
		wakame: {
			async tokenize(text) {
				calls.push(text);
				return tokenize(text);
			},
		},
	};
}

void test("tokenizes text across inline elements while respecting excluded contexts", async () => {
	const { calls, wakame } = createWakame();
	const output = await transformHtml(
		"<p>日<b>本</b><nobr>語</nobr>です<br>次</p><pre>対象外</pre><svg><text>対象外</text></svg><template><p>対象外</p></template>",
		wakame,
	);

	assert.deepEqual(calls, ["日本語です", "次"]);
	assert.match(output, /日<b><wbr>本<wbr><\/b><nobr>語<\/nobr><wbr>で<wbr>す<br>次/);
	assert.match(output, /<pre>\n対象外<\/pre>/);
	assert.match(output, /<svg><text>対象外<\/text><\/svg>/);
	assert.match(output, /<template><p>対象外<\/p><\/template>/);
});

void test("preserves or removes existing HTML wbr elements according to options", async () => {
	const tokenizeWholeParagraph = () => ["日本語"];
	const preserved = await transformHtml(
		"<p>日<wbr>本語</p>",
		createWakame(tokenizeWholeParagraph).wakame,
	);
	const recomputed = await transformHtml(
		"<p>日<wbr>本語</p>",
		createWakame(tokenizeWholeParagraph).wakame,
		true,
		{ preserveExistingWbr: false },
	);

	assert.match(preserved, /日<wbr>本語/);
	assert.doesNotMatch(recomputed, /<wbr>/);
});

void test("maps UTF-16 tokenizer boundaries around astral characters", async () => {
	const { calls, wakame } = createWakame();
	const output = await transformHtml("<p>𠮷野家😀</p>", wakame);

	assert.deepEqual(calls, ["𠮷野家😀"]);
	assert.match(
		output,
		/<p style="word-break: keep-all; overflow-wrap: anywhere;">𠮷<wbr>野<wbr>家<wbr>😀<\/p>/,
	);
});

void test("applies breaks safely across nested blocks and surrounding text", async () => {
	const { calls, wakame } = createWakame();
	const output = await transformHtml(
		"<div>日本<p>東京</p>京都<section>大阪</section>奈良</div>",
		wakame,
	);

	assert.deepEqual(calls, ["東京", "大阪", "日本京都奈良"]);
	assert.match(
		output,
		/日<wbr>本<p[^>]*>東<wbr>京<\/p><wbr>京<wbr>都<section[^>]*>大<wbr>阪<\/section><wbr>奈<wbr>良/,
	);
});

void test("keeps forced zero-width breaks, style behavior, and style idempotence", async () => {
	const { calls, wakame } = createWakame(() => ["日本​語"]);
	const output = await transformHtml(
		'<p style="color:red; word-break: keep-all; overflow-wrap: anywhere;">日本​語</p>',
		wakame,
	);

	assert.deepEqual(calls, ["日本​語"]);
	assert.match(output, /style="color:red; word-break: keep-all; overflow-wrap: anywhere;"/);
	assert.doesNotMatch(output, /overflow-wrap: anywhere;[^"]*overflow-wrap/);
});

void test("throws when tokenizer output cannot reconstruct paragraph text", async () => {
	const { wakame } = createWakame(() => ["別のテキスト"]);

	await assert.rejects(
		transformHtml("<p>元のテキスト</p>", wakame),
		/Wakame tokenizer output does not reconstruct the paragraph text/,
	);
});

void test("does not initialize the parser for empty HTML", async () => {
	const { calls, wakame } = createWakame();

	assert.equal(await transformHtml("", wakame), "");
	assert.deepEqual(calls, []);
});
