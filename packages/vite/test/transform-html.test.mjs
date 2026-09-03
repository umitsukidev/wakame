import assert from "node:assert/strict";
import test from "node:test";
import { transformHtml } from "../dist/index.js";

test("does not insert break opportunities between inline SVG elements", async () => {
	const source = `<h2>導入<svg aria-label="日本語">
	<defs>
		<style>.cls-1 { fill: currentColor; }</style>
	</defs>
	<desc>日本語のロゴ</desc>
	<path class="cls-1" d="M0 0h24v24H0z" />
	<path class="cls-2" d="M2 2h20v20H2z" />
</svg>見出し</h2>`;
	const wakame = {
		tokenize: async (text) => (text === "導入見出し" ? ["導入", "見出し"] : Array.from(text)),
	};

	const transformed = await transformHtml(source, wakame, true);
	const svg = transformed.slice(transformed.indexOf("<svg"), transformed.indexOf("</svg>") + 6);

	assert.doesNotMatch(svg, /<wbr/);
	assert.match(svg, /<\/defs>\s*<desc>日本語のロゴ<\/desc>\s*<path/);
	assert.match(
		transformed,
		/<h2 style="word-break: keep-all; overflow-wrap: anywhere;">導入<svg[\s\S]*<\/svg><wbr>見出し<\/h2>/,
	);
});

test("preserves foreign-content descendants when recomputing breaks", async () => {
	const source =
		"<svg><foreignObject><div>SVG内のHTML</div></foreignObject><wbr /></svg><p>通常の本文</p>";
	const wakame = {
		tokenize: async (text) => (text === "通常の本文" ? ["通常の", "本文"] : [text]),
	};

	const transformed = await transformHtml(source, wakame, false, {
		preserveExistingWbr: false,
	});
	const svg = transformed.slice(transformed.indexOf("<svg"), transformed.indexOf("</svg>") + 6);

	assert.equal(svg, "<svg><foreignObject><div>SVG内のHTML</div></foreignObject><wbr></wbr></svg>");
});
