import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build, createServer, type Plugin } from "vite";
import { wakameSvelteVite } from "../src/vite.js";

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

const card = `<script>let { as = 'div', children } = $props();</script><svelte:element this={as}>{@render children()}</svelte:element>`;
const source = `<script>import Card from '@/Card.svelte'; import Banner from '@/Banner.svelte'; import Bad from '@/Bad.svelte'; import Unknown from '@/Unknown.svelte'; let tag = 'div'; let text = '日本語';</script>
<Card as="section"><p>日本語</p><Banner>文章</Banner></Card><Card><p>既定</p></Card><Card as={tag}>動的</Card>
<Bad>危険</Bad><Unknown>不明</Unknown><pre><Card>除外</Card></pre><div contenteditable><Card>編集</Card></div><Card>{text}</Card><Card><p>BEFORE</p></Card>`;

describe("wakameSvelteVite", () => {
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
					wakameSvelteVite({ tokenizer }),
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
		const plugin = wakameSvelteVite({ tokenizer });
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
		const plugin = wakameSvelteVite({ tokenizer });
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
		const plugin = wakameSvelteVite({ tokenizer });
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
