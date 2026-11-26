import { describe, expect, it } from "vitest";
import { compile, preprocess } from "svelte/compiler";
import { wakamePreprocess } from "../src/index.js";
import type { Tokenizer } from "@wakamejs/core";

const tokenizer: Tokenizer<string> = {
	async tokenize(text) {
		return Array.from(text);
	},
};

async function transform(source: string) {
	return preprocess(source, wakamePreprocess({ tokenizer }), { filename: "/src/Example.svelte" });
}

describe("wakamePreprocess", () => {
	it("inserts breaks into static Japanese text without changing other source", async () => {
		const source = `<script>let value = "日本語";</script>\n<p class="日本語">日本語 {value}<!-- 日本語 -->文章です</p>`;
		const result = await transform(source);
		expect(result.code).toBe(
			`<script>let value = "日本語";</script>\n<p class="日本語">日<wbr>本<wbr>語 {value}<!-- 日本語 -->文<wbr>章<wbr>で<wbr>す</p>`,
		);
		const sourcemap = result.map;
		if (!sourcemap) throw new Error("Expected a preprocessing source map");
		const map = JSON.parse(JSON.stringify(sourcemap)) as { sources: string[]; mappings: string };
		expect(map.sources).toContain("Example.svelte");
		expect(map.mappings).toBeTruthy();
		for (const generate of ["client", "server"] as const) {
			expect(() =>
				compile(result.code, { filename: "/src/Example.svelte", generate, sourcemap }),
			).not.toThrow();
		}
	});

	it("walks conditional, each, await, key and snippet fragments", async () => {
		const source = `{#snippet example()}見出し{/snippet}{#if true}日本語{:else}文章{/if}{#each [] as item}本文{:else}空欄{/each}{#await Promise.resolve()}待機{:then value}成功{:catch error}失敗{/await}{#key 1}更新{/key}`;
		const { code } = await transform(source);
		for (const value of [
			"見<wbr>出<wbr>し",
			"日<wbr>本<wbr>語",
			"文<wbr>章",
			"本<wbr>文",
			"空<wbr>欄",
			"待<wbr>機",
			"成<wbr>功",
			"失<wbr>敗",
			"更<wbr>新",
		]) {
			expect(code).toContain(value);
		}
		expect(() => compile(code, { generate: "server" })).not.toThrow();
	});

	it("leaves unsafe contexts, attributes, dynamic HTML and entities alone", async () => {
		const source = `<pre>日本語</pre><code>日本語</code><textarea>日本語</textarea><svg><text>日本語</text></svg><math><mi>日本語</mi></math><div contenteditable>日本語</div><div data-wakame-ignore><p>日本語</p></div><div {...props}>日本語</div><p>日本語 &amp; 文章</p>{@html value}<Component>日本語</Component>`;
		expect((await transform(source)).code).toBe(source);
	});

	it("processes safe descendants inside restricted containers", async () => {
		const source = `<table><tbody><tr><td>日本語</td></tr></tbody></table><ul><li>文章</li></ul>`;
		const { code } = await transform(source);
		expect(code).toBe(
			`<table><tbody><tr><td>日<wbr>本<wbr>語</td></tr></tbody></table><ul><li>文<wbr>章</li></ul>`,
		);
		expect(() => compile(code, { generate: "server" })).not.toThrow();
	});

	it("keeps existing breaks and is idempotent", async () => {
		const source = `<p>日本語<wbr>文章です</p><p>こんにちは</p>`;
		const once = (await transform(source)).code;
		expect(once).toBe(`<p>日本語<wbr>文章です</p><p>こ<wbr>ん<wbr>に<wbr>ち<wbr>は</p>`);
		expect((await transform(once)).code).toBe(once);
	});

	it("does not insert beside whitespace or split surrogate pairs", async () => {
		const source = `<p> 日本 語𠮷野 です </p>`;
		const { code } = await transform(source);
		expect(code).toBe(`<p> 日<wbr>本 語<wbr>𠮷<wbr>野 で<wbr>す </p>`);
		expect(code.replaceAll("<wbr>", "")).toBe(source);
	});

	it("normalizes dictionary input and rejects invalid token streams", async () => {
		const seen: string[][] = [];
		const dictionaryTokenizer: Tokenizer<string> = {
			async tokenize(text, dictionary) {
				seen.push([...dictionary]);
				return [text];
			},
		};
		await preprocess(
			"<p>日本語</p>",
			wakamePreprocess({ tokenizer: dictionaryTokenizer, dictionary: ["語", "語"] }),
		);
		expect(seen).toEqual([["語"]]);
		await expect(
			preprocess(
				"<p>日本語</p>",
				wakamePreprocess({
					tokenizer: {
						async tokenize() {
							return ["別"];
						},
					},
				}),
			),
		).rejects.toThrow("does not reconstruct");
	});
});
