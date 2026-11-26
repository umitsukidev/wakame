import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build, createServer, type Plugin } from "vite";
import wakame from "../src/vite.js";

const tokenizer = {
	async tokenize(text: string) {
		return Array.from(text);
	},
};
const fixtures: string[] = [];
async function fixture() {
	const dir = await mkdtemp(path.join(process.cwd(), "test", ".vite-fixture-"));
	fixtures.push(dir);
	return dir;
}
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const card = `<script lang="ts">
import type { Snippet } from "svelte";
interface Props { as?: "div" | "section"; interactive?: boolean; children: Snippet }
let { as = "div", interactive = false, children }: Props = $props();
</script><svelte:element this={as} class:interactive>{@render children()}</svelte:element>`;
const source = `<script>import Card from '@/Card.svelte'; import Banner from '@/Banner.svelte'; import Bad from '@/Bad.svelte'; import Unknown from '@/Unknown.svelte'; import Section from '@/Section.svelte'; import UnsafeSection from '@/UnsafeSection.svelte'; import Header from '@/Header.svelte'; import HeaderReverse from '@/HeaderReverse.svelte'; let tag = 'div'; let text = '日本語';</script>
<Card as="section"><p>日本語</p><Banner>文章</Banner></Card><Card><p>既定</p></Card><Card as={tag}>動的</Card>
<Bad>危険</Bad><Unknown>不明</Unknown><pre><Card>除外</Card></pre><div contenteditable><Card>編集</Card></div><Card>{text}</Card><Card><p>BEFORE</p></Card><Section><p>入れ子</p></Section><UnsafeSection>危険</UnsafeSection>
<Header>直下{#snippet description()}<p>説明文</p>{/snippet}{#snippet actions()}操作{/snippet}</Header>
<HeaderReverse>本文{#snippet description()}説明{/snippet}</HeaderReverse>`;

describe("wakame Vite plugin", () => {
	it.each(["serve", "build"] as const)(
		"uses Vite resolution after preprocessing in %s",
		async (mode) => {
			const dir = await fixture();
			await Promise.all([
				writeFile(path.join(dir, "Card.svelte"), card),
				writeFile(
					path.join(dir, "Banner.svelte"),
					`<script>let { children } = $props();</script><div>{@render children()}</div>`,
				),
				writeFile(
					path.join(dir, "Bad.svelte"),
					`<script>let { children } = $props();</script>{#if true}<div>{@render children()}</div>{:else}<pre>{@render children()}</pre>{/if}`,
				),
				writeFile(
					path.join(dir, "Unknown.svelte"),
					`<script>let { children } = $props();</script><Other>{@render children()}</Other>`,
				),
				writeFile(
					path.join(dir, "Section.svelte"),
					`<script>import Card from './Card.svelte'; let { children } = $props();</script><Card as="section"><div>{@render children()}</div></Card>`,
				),
				writeFile(
					path.join(dir, "UnsafeSection.svelte"),
					`<script>import Card from './Card.svelte'; let { children } = $props();</script><Card as="pre">{@render children()}</Card>`,
				),
				writeFile(
					path.join(dir, "Header.svelte"),
					`<script>let { children, description, actions } = $props();</script><header><div>{@render description?.()}</div><pre>{@render children?.()}{@render actions?.()}</pre><div>{@render actions?.()}</div></header>`,
				),
				writeFile(
					path.join(dir, "HeaderReverse.svelte"),
					`<script>let { children, description } = $props();</script><div>{@render children()}</div><pre>{@render description?.()}</pre>`,
				),
				writeFile(path.join(dir, "Entry.svelte"), source),
			]);
			const seen = new Map<string, string>();
			const capture: Plugin = {
				name: "capture-wakame",
				transform: {
					handler(code, id) {
						if (id.endsWith(".svelte")) seen.set(id, code);
					},
				},
			};
			const config = {
				configFile: false as const,
				root: dir,
				resolve: { alias: { "@": dir } },
				plugins: [
					wakame({ tokenizer }),
					capture,
					svelte({
						preprocess: {
							markup: ({ content }) => ({ code: content.replace("BEFORE", "前処理") }),
						},
					}),
				],
			};
			if (mode === "serve") {
				const server = await createServer({ ...config, server: { middlewareMode: true } });
				try {
					expect(await server.transformRequest("/Entry.svelte")).toBeTruthy();
				} finally {
					await server.close();
				}
			} else {
				await build({
					...config,
					build: {
						write: false,
						lib: { entry: path.join(dir, "Entry.svelte"), formats: ["es"] },
						rollupOptions: { external: (id) => id === "svelte" || id.startsWith("svelte/") },
					},
				});
			}
			const output = seen.get(path.join(dir, "Entry.svelte"));
			expect(output).toContain("<p>日<wbr>本<wbr>語</p>");
			expect(output).toContain("<Banner>文<wbr>章</Banner>");
			expect(output).toContain("<p>既<wbr>定</p>");
			expect(output).toContain("<p>前<wbr>処<wbr>理</p>");
			expect(output).toContain("<Section><p>入<wbr>れ<wbr>子</p></Section>");
			expect(output).toContain("<UnsafeSection>危険</UnsafeSection>");
			expect(output).toContain(
				"<Header>直下{#snippet description()}<p>説<wbr>明<wbr>文</p>{/snippet}{#snippet actions()}操作{/snippet}</Header>",
			);
			expect(output).toContain(
				"<HeaderReverse>本<wbr>文{#snippet description()}説明{/snippet}</HeaderReverse>",
			);
			for (const unchanged of [
				"<Card as={tag}>動的</Card>",
				"<Bad>危険</Bad>",
				"<Unknown>不明</Unknown>",
				"<pre><Card>除外</Card></pre>",
				"<div contenteditable><Card>編集</Card></div>",
				"<Card>{text}</Card>",
			])
				expect(output).toContain(unchanged);
		},
	);
});

describe("watching and maps", () => {
	it("watches resolved components even when no code changes and ignores query modules", async () => {
		const dir = await fixture();
		const target = path.join(dir, "Card.svelte");
		await writeFile(target, card);
		const watched: string[] = [];
		const plugin = wakame({ tokenizer });
		const transform = plugin.transform;
		if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
		const context = {
			async resolve() {
				return { id: target, external: false };
			},
			addWatchFile(id: string) {
				watched.push(id);
			},
		};
		const handler = transform.handler as unknown as (
			this: typeof context,
			code: string,
			id: string,
		) => Promise<{ code: string; map: string } | undefined>;
		const noChange = `<script>import Card from './Card.svelte'; let tag = 'div';</script><Card as={tag}>日本語</Card>`;
		expect(await handler.call(context, noChange, path.join(dir, "Entry.svelte"))).toBeUndefined();
		expect(watched).toEqual([target]);
		const changed = `<script>import Card from './Card.svelte';</script><Card>日本語</Card>`;
		const result = await handler.call(context, changed, path.join(dir, "Entry.svelte"));
		expect(result?.code).toContain("日<wbr>本<wbr>語");
		expect(JSON.parse(result!.map).mappings).toBeTruthy();
		expect(
			await handler.call(context, result!.code, path.join(dir, "Entry.svelte")),
		).toBeUndefined();
		const count = watched.length;
		expect(
			await handler.call(context, changed, path.join(dir, "Entry.svelte?type=style")),
		).toBeUndefined();
		expect(watched).toHaveLength(count);
	});
});

describe("component safety", () => {
	it.each([
		`<pre>{@render children()}</pre>`,
		`<svg><text>{@render children()}</text></svg>`,
		`<math><mi>{@render children()}</mi></math>`,
		`<div data-wakame-ignore>{@render children()}</div>`,
		`<div contenteditable>{@render children()}</div>`,
		`<div {...props}>{@render children()}</div>`,
		`<table>{@render children()}</table>`,
		`<Unknown>{@render children()}</Unknown>`,
		`<svelte:element this={tag}>{@render children()}</svelte:element>`,
		`{#if true}<div>{@render children()}</div>{:else}<pre>{@render children()}</pre>{/if}`,
	])("preserves child text in unsafe or uncertain contexts: %s", async (markup) => {
		const dir = await fixture();
		const target = path.join(dir, "Card.svelte");
		await writeFile(target, `<script>let { children } = $props();</script>${markup}`);
		const plugin = wakame({ tokenizer });
		const transform = plugin.transform;
		if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
		const handler = transform.handler as unknown as (
			this: object,
			code: string,
			id: string,
		) => Promise<unknown>;
		const context = {
			async resolve() {
				return { id: target, external: false };
			},
			addWatchFile() {},
		};
		const source = `<script>import Card from './Card.svelte';</script><Card>日本語</Card>`;
		expect(await handler.call(context, source, path.join(dir, "Entry.svelte"))).toBeUndefined();
	});

	it("does not assume a shadowed component binding is the imported component", async () => {
		const dir = await fixture();
		const target = path.join(dir, "Card.svelte");
		await writeFile(target, card);
		const plugin = wakame({ tokenizer });
		const transform = plugin.transform;
		if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
		const handler = transform.handler as unknown as (
			this: object,
			code: string,
			id: string,
		) => Promise<unknown>;
		const context = {
			async resolve() {
				return { id: target, external: false };
			},
			addWatchFile() {},
		};
		const source = `<script>import Card from './Card.svelte';</script>{#each [] as Card}<Card>日本語</Card>{/each}`;
		expect(await handler.call(context, source, path.join(dir, "Entry.svelte"))).toBeUndefined();
	});
});

describe("TypeScript runtime references", () => {
	it.each([
		`let { as = "div", children }: Props = $props(); as = ("pre" as string);`,
		`let { as = "div", children }: Props = $props(); const alias = children as unknown;`,
	])(
		"still rejects unsafe value references inside TypeScript expressions",
		async (declarations) => {
			const dir = await fixture();
			const target = path.join(dir, "Card.svelte");
			await writeFile(
				target,
				`<script lang="ts">interface Props { as?: string; children: unknown } ${declarations}</script><svelte:element this={as}>{@render children()}</svelte:element>`,
			);
			const plugin = wakame({ tokenizer });
			const transform = plugin.transform;
			if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
			const handler = transform.handler as unknown as (
				this: object,
				code: string,
				id: string,
			) => Promise<unknown>;
			const context = {
				async resolve() {
					return { id: target, external: false };
				},
				addWatchFile() {},
			};
			const source = `<script>import Card from './Card.svelte';</script><Card>日本語</Card>`;
			expect(await handler.call(context, source, path.join(dir, "Entry.svelte"))).toBeUndefined();
		},
	);
});

describe("nested component resolution", () => {
	it("rejects cycles and watches every consulted component", async () => {
		const dir = await fixture();
		const a = path.join(dir, "A.svelte");
		const b = path.join(dir, "B.svelte");
		await writeFile(
			a,
			`<script>import B from './B.svelte'; let { children } = $props();</script><B>{@render children()}</B>`,
		);
		await writeFile(
			b,
			`<script>import A from './A.svelte'; let { children } = $props();</script><A>{@render children()}</A>`,
		);
		const watched: string[] = [];
		const transform = wakame({ tokenizer }).transform;
		if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
		const handler = transform.handler as unknown as (
			this: object,
			code: string,
			id: string,
		) => Promise<unknown>;
		const context = {
			async resolve(specifier: string, importer: string) {
				return { id: path.resolve(path.dirname(importer), specifier), external: false };
			},
			addWatchFile(id: string) {
				watched.push(id);
			},
		};
		const source = `<script>import A from './A.svelte';</script><A>日本語</A>`;
		expect(await handler.call(context, source, path.join(dir, "Entry.svelte"))).toBeUndefined();
		expect(watched).toContain(a);
		expect(watched).toContain(b);
	});
});

describe("relative imports in nested components", () => {
	it("resolves the same specifier against each importer", async () => {
		const dir = await fixture();
		const a = path.join(dir, "a");
		const b = path.join(dir, "b");
		await Promise.all([mkdir(a), mkdir(b)]);
		const wrapper = `<script>import Card from './Card.svelte'; let { children } = $props();</script><Card>{@render children()}</Card>`;
		await Promise.all([
			writeFile(path.join(a, "Wrapper.svelte"), wrapper),
			writeFile(path.join(b, "Wrapper.svelte"), wrapper),
			writeFile(
				path.join(a, "Card.svelte"),
				`<script>let { children } = $props();</script><div>{@render children()}</div>`,
			),
			writeFile(
				path.join(b, "Card.svelte"),
				`<script>let { children } = $props();</script><pre>{@render children()}</pre>`,
			),
		]);
		const watched: string[] = [];
		const transform = wakame({ tokenizer }).transform;
		if (!transform || typeof transform === "function") throw new Error("Expected transform hook");
		const handler = transform.handler as unknown as (
			this: object,
			code: string,
			id: string,
		) => Promise<{ code: string } | undefined>;
		const context = {
			async resolve(specifier: string, importer: string) {
				return { id: path.resolve(path.dirname(importer), specifier), external: false };
			},
			addWatchFile(id: string) {
				watched.push(id);
			},
		};
		const source = `<script>import A from './a/Wrapper.svelte'; import B from './b/Wrapper.svelte';</script><A>日本語</A><B>危険</B>`;
		const result = await handler.call(context, source, path.join(dir, "Entry.svelte"));
		expect(result?.code).toContain("<A>日<wbr>本<wbr>語</A><B>危険</B>");
		expect(watched).toContain(path.join(a, "Card.svelte"));
		expect(watched).toContain(path.join(b, "Card.svelte"));
	});
});
