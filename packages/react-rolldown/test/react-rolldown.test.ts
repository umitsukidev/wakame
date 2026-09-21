import { mkdtempDisposableSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import React, { type ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { rolldown } from "rolldown";
import { build, createServer } from "vite";
import { describe, expect, test } from "vitest";
import wakameReactPlugin, { type ReactRolldownPluginOptions } from "../dist/index.js";

type TestTokenizer = ReactRolldownPluginOptions["tokenizer"];
type TransformOptions = Omit<Partial<ReactRolldownPluginOptions>, "tokenizer"> & {
	tokenizer?: TestTokenizer;
};

interface TokenizerCall {
	text: string;
	dictionary: string[];
}

interface TransformResult {
	code: string;
	map: {
		version: number;
		sources?: readonly string[];
	};
}

const runtimeModuleRequest = "virtual:test-wakame-runtime";
const runtimeModuleId = `\0${runtimeModuleRequest}`;

const runtimeModulePlugin = {
	name: "test-wakame-runtime",
	resolveId(source: string) {
		return source === runtimeModuleRequest ? runtimeModuleId : null;
	},
	load(id: string) {
		if (id !== runtimeModuleId) return null;
		return `export function createTestSegmenter(options, context) {
  if (JSON.stringify(options?.expectedDictionary ?? []) !== JSON.stringify(context.dictionary)) {
    throw new Error("runtime dictionary mismatch");
  }
  return { segment(text) {
    if (text === "動的日本語" || text === "配列日本語") return [text.slice(0, 2), text.slice(2)];
    return [text.slice(0, 1), text.slice(1)];
  } };
}`;
	},
};

function createTokenizer(splitText: (text: string) => readonly string[] = (text) => [text]): {
	calls: TokenizerCall[];
	tokenizer: TestTokenizer;
} {
	const calls: TokenizerCall[] = [];
	return {
		calls,
		tokenizer: {
			async tokenize(text, dictionary) {
				calls.push({ text, dictionary: [...dictionary] });
				return splitText(text);
			},
		},
	};
}

function createRuntimeTokenizer(
	splitText: (text: string) => readonly string[] = (text) => [text],
	expectedDictionary: readonly string[] = [],
): {
	calls: TokenizerCall[];
	tokenizer: TestTokenizer;
} {
	const result = createTokenizer(splitText);
	return {
		calls: result.calls,
		tokenizer: {
			...result.tokenizer,
			runtime: {
				module: runtimeModuleRequest,
				export: "createTestSegmenter",
				options: { expectedDictionary: [...expectedDictionary] },
			},
		},
	};
}

function createFileRuntimeTokenizer(): TestTokenizer {
	return {
		async tokenize(text) {
			return [text.slice(0, 2), text.slice(2)];
		},
		runtime: {
			module: join(process.cwd(), "test/runtime-fixture.mjs"),
			export: "createTestSegmenter",
		},
	};
}

async function transform(
	source: string,
	id = "/project/src/App.jsx",
	options: TransformOptions = {},
): Promise<TransformResult | null> {
	const { tokenizer, ...pluginOptions } = options;
	const plugin = wakameReactPlugin({
		tokenizer: tokenizer ?? createTokenizer().tokenizer,
		...pluginOptions,
	});
	const transformHook = plugin.transform;
	if (
		transformHook === undefined ||
		typeof transformHook === "function" ||
		!("handler" in transformHook)
	) {
		throw new Error("Expected a transform hook object");
	}
	const handler = transformHook.handler as unknown as (
		code: string,
		id: string,
	) => Promise<TransformResult | null>;
	return handler(source, id);
}

function requireResult(result: Awaited<ReturnType<typeof transform>>): TransformResult {
	if (result === null) throw new Error("Expected the source to be transformed");
	return result;
}

describe("react-rolldown plugin", () => {
	test("normalizes JSX whitespace and decodes entities through Babel builders", async () => {
		const { calls, tokenizer } = createTokenizer((text) =>
			text === "こんにちは & 世界" ? ["こんにちは & ", "世界"] : [text],
		);
		const result = requireResult(
			await transform(
				"const view = <div>\n  こんにちは &amp; 世界\n</div>;",
				"/project/src/App.jsx",
				{ tokenizer },
			),
		);

		expect(calls[0]?.text).toBe("こんにちは & 世界");
		expect(result.code).toMatch(/\\u3053\\u3093\\u306B\\u3061\\u306F &/);
		expect(result.code).toMatch(/\\u200B/);
	});

	test("transforms direct string literal JSX expressions", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
		);
		const result = requireResult(
			await transform('const view = <div>{"こんにちは世界"}</div>;', "/project/src/App.jsx", {
				tokenizer,
			}),
		);

		expect(result.code).toMatch(/\{"\\u3053\\u3093\\u306B\\u3061\\u306F\\u200B\\u4E16\\u754C"\}/);
	});

	test("parses TSX and returns a source map", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
		);
		const result = requireResult(
			await transform(
				"type Props = {};\nexport const View = (_props: Props) => <div>こんにちは世界</div>;",
				"/project/src/View.tsx",
				{ tokenizer },
			),
		);

		expect(result.map).toMatchObject({ version: 3, sources: ["/project/src/View.tsx"] });
		expect(result.code).toMatch(/\\u200B/);
	});

	test("ignores empty tokens when creating break opportunities", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "日本語" ? ["", "日本", "語"] : [text],
		);
		const result = requireResult(
			await transform("const view = <div>日本語</div>;", "/project/src/App.jsx", { tokenizer }),
		);

		expect(result.code).toMatch(/\{"\\u65E5\\u672C\\u200B\\u8A9E"\}/);
		expect(result.code).not.toMatch(/<wbr\s*\/>/);
	});

	test("accepts additional Babel parser plugins for decorators", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
		);
		const result = requireResult(
			await transform(
				"@sealed class Model {}\nexport const view = <div>こんにちは世界</div>;",
				"/project/src/View.tsx",
				{ tokenizer, parserPlugins: ["decorators-legacy"] },
			),
		);

		expect(result.code).toMatch(/\\u200B/);
	});

	test("does not join text across inline JSX children or transform excluded content", async () => {
		const { calls, tokenizer } = createRuntimeTokenizer((text) => [
			text.slice(0, 1),
			text.slice(1),
		]);
		const result = requireResult(
			await transform(
				`const dynamic = "動的";
const portalTarget = document.body;
const view = <>
  <div>{dynamic}</div>
\t  <div>{\`テンプレート\`}</div>
  <div>インライン<span>跨ぎ</span>本文</div>
  <MyComponent><div>カスタム配下</div></MyComponent>
  <Namespace.Component>メンバー配下</Namespace.Component>
  <svg><text>SVG</text></svg>
  <math><mi>Math</mi></math>
  <table><tbody><tr><td>Table</td></tr></tbody></table>
  <div contentEditable>編集可能</div>
  <div dangerouslySetInnerHTML={{ __html: "危険" }} />
  <div data-wakame-ignore>除外<main>除外子孫</main></div>
  {createPortal(<div>Portal</div>, portalTarget)}
  <pre>Pre</pre><code>Code</code>
</>;`,
				"/project/src/App.jsx",
				{ tokenizer },
			),
		);

		expect(result.code).toMatch(
			/<MyComponent><div>\{"\\u30AB\\u200B\\u30B9\\u30BF\\u30E0\\u914D\\u4E0B"\}<\/div><\/MyComponent>/,
		);
		expect(result.code).toMatch(
			/<Namespace\.Component>[\s\S]*\\u200B[\s\S]*<\/Namespace\.Component>/,
		);
		expect(result.code).toMatch(/<svg><text>SVG<\/text><\/svg>/);
		expect(result.code).toMatch(/<table><tbody><tr><td>Table<\/td><\/tr><\/tbody><\/table>/);
		expect(result.code).toContain("virtual:@wakamejs/react-rolldown/runtime");
		expect(calls.some(({ text }) => text === "Portal")).toBe(false);
		expect(calls.some(({ text }) => text === "編集可能")).toBe(false);
		expect(calls.some(({ text }) => text === "除外")).toBe(false);
		expect(calls.some(({ text }) => text === "除外子孫")).toBe(false);
		expect(calls.some(({ text }) => text === "インライン跨ぎ本文")).toBe(false);
		expect(calls.some(({ text }) => text === "インライン")).toBe(true);
		expect(calls.some(({ text }) => text === "跨ぎ")).toBe(true);
		expect(calls.some(({ text }) => text === "本文")).toBe(true);
	});

	test("transforms custom component text and descendants", async () => {
		const { calls, tokenizer } = createTokenizer((text) => {
			if (text === "直接の日本語") return ["直接の", "日本語"];
			if (text === "静的な式") return ["静的な", "式"];
			if (text === "日本語の見出し") return ["日本語", "の見出し"];
			return [text];
		});
		const result = requireResult(
			await transform(
				`const view = <PageLayout>
				  直接の日本語
				  {"静的な式"}
				  <main><h1>日本語の見出し</h1></main>
				</PageLayout>;`,
				"/project/src/App.jsx",
				{ tokenizer },
			),
		);

		expect(result.code).toMatch(/\{"\\u76F4\\u63A5\\u306E\\u200B\\u65E5\\u672C\\u8A9E"\}/);
		expect(result.code).toMatch(/\{"\\u9759\\u7684\\u306A\\u200B\\u5F0F"\}/);
		expect(result.code).toMatch(
			/<main><h1>\{"\\u65E5\\u672C\\u8A9E\\u200B\\u306E\\u898B\\u51FA\\u3057"\}<\/h1><\/main>/,
		);
		expect(calls.map(({ text }) => text)).toEqual(["直接の日本語", "静的な式", "日本語の見出し"]);
	});

	test("processes static and dynamic direct children of JSX fragments", async () => {
		const { calls, tokenizer } = createRuntimeTokenizer((text) =>
			text === "フラグメント静的" ? ["フラグメント", "静的"] : [text],
		);
		const result = requireResult(
			await transform(
				`function Component({ value }) { return <>フラグメント静的{value}</>; }`,
				"/project/src/App.jsx",
				{ tokenizer },
			),
		);

		expect(calls.map(({ text }) => text)).toEqual(["フラグメント静的"]);
		expect(result.code).toMatch(
			/\{"\\u30D5\\u30E9\\u30B0\\u30E1\\u30F3\\u30C8\\u200B\\u9759\\u7684"\}/,
		);
		expect(result.code).toMatch(/_wakameRuntime\(value\)/);
	});

	test("does not duplicate existing static zero-width spaces", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "日本\u200B語" ? ["日本", "\u200B語"] : [text],
		);
		const result = requireResult(
			await transform('const view = <div>{"日本\u200B語"}</div>;', "/project/src/App.jsx", {
				tokenizer,
			}),
		);

		expect(result.code).toContain("\\u65E5\\u672C\\u200B\\u8A9E");
		expect(result.code).not.toContain("\\u200B\\u200B");
	});

	test("ignores configured identifier, member, and namespaced components", async () => {
		const { calls, tokenizer } = createTokenizer((text) => [text.slice(0, 1), text.slice(1)]);
		const result = requireResult(
			await transform(
				`const view = <>
				  <PageLayout>無視直下<div>無視子孫</div></PageLayout>
				  <Namespace.Component>無視直下<div>無視子孫</div></Namespace.Component>
				  <Namespace:Component>無視直下<div>無視子孫</div></Namespace:Component>
				  <OtherComponent>対象直下<span>対象子孫</span></OtherComponent>
				</>;`,
				"/project/src/App.jsx",
				{
					tokenizer,
					ignore: ["PageLayout", "Namespace.Component", "Namespace:Component"],
				},
			),
		);

		expect(calls.map(({ text }) => text)).toEqual(["対象直下", "対象子孫"]);
		expect(result.code).toContain("無視直下");
		expect(result.code).toContain("無視子孫");
		expect(result.code).not.toContain("対象直下");
		expect(result.code).not.toContain("対象子孫");
	});

	test("wraps dynamic strings and arrays with the runtime helper", async () => {
		using temporaryDirectory = mkdtempDisposableSync(join(tmpdir(), "wakame-react-runtime-"));
		const directory = temporaryDirectory.path;
		const nodeModules = join(directory, "node_modules");
		mkdirSync(nodeModules);
		symlinkSync(join(process.cwd(), "node_modules/react"), join(nodeModules, "react"), "dir");
		const entry = join(directory, "App.jsx");
		writeFileSync(
			entry,
			'import React from "react";\nfunction Paragraph({ children }) { return <section>{children}</section>; }\nexport function App({ value, items }) { return <Paragraph>{value}{items}{42}</Paragraph>; }\n',
		);
		const { tokenizer } = createRuntimeTokenizer(undefined, ["固有語"]);
		const build = await rolldown({
			input: entry,
			external: [/^react(?:\/|$)/],
			plugins: [runtimeModulePlugin, wakameReactPlugin({ tokenizer, dictionary: ["固有語"] })],
			transform: { jsx: "react-jsx" },
		});
		const generated = await build.generate({ format: "esm" });
		const output = generated.output.find((item) => item.type === "chunk");
		if (output === undefined || output.type !== "chunk") throw new Error("Expected a chunk");
		const outputPath = join(directory, "runtime.mjs");
		writeFileSync(outputPath, output.code);
		const module = (await import(`${pathToFileURL(outputPath).href}?runtime`)) as {
			App: ComponentType<{ value: string; items: string[] }>;
		};

		const html = renderToString(
			React.createElement(module.App, {
				value: "動的日本語",
				items: ["配列日本語", "既に\u200B済"],
			}),
		);
		expect(html).toContain("動的\u200B日本語");
		expect(html).toContain("配列\u200B日本語");
		expect(html.match(/既に\u200B済/g)?.length).toBe(1);
	});

	test("rejects dynamic JSX when the tokenizer has no runtime descriptor", async () => {
		await expect(
			transform("const view = <div>{value}</div>;", "/project/src/App.jsx"),
		).rejects.toThrow(/does not provide a runtime descriptor/);
	});

	test("works as a top-level Vite plugin during dev SSR transforms", async () => {
		using temporaryDirectory = mkdtempDisposableSync(join(tmpdir(), "wakame-vite-dev-"));
		const directory = temporaryDirectory.path;
		const nodeModules = join(directory, "node_modules");
		mkdirSync(nodeModules);
		symlinkSync(join(process.cwd(), "node_modules/react"), join(nodeModules, "react"), "dir");
		writeFileSync(
			join(directory, "App.jsx"),
			'import React from "react";\nexport function App({ value }) { return <main>{value}</main>; }\n',
		);
		const server = await createServer({
			root: directory,
			appType: "custom",
			logLevel: "silent",
			plugins: [wakameReactPlugin({ tokenizer: createFileRuntimeTokenizer() })],
			server: { middlewareMode: true },
		});
		try {
			const transformed = await server.transformRequest("/App.jsx", { ssr: true });
			expect(transformed?.code).toContain("virtual:@wakamejs/react-rolldown/runtime");
			expect(transformed?.code).toContain("__vite_ssr_import__");
		} finally {
			await server.close();
		}
	});

	test("works as a top-level Vite plugin during production SSR builds", async () => {
		using temporaryDirectory = mkdtempDisposableSync(join(tmpdir(), "wakame-vite-prod-"));
		const directory = temporaryDirectory.path;
		const nodeModules = join(directory, "node_modules");
		mkdirSync(nodeModules);
		symlinkSync(join(process.cwd(), "node_modules/react"), join(nodeModules, "react"), "dir");
		const entry = join(directory, "App.jsx");
		writeFileSync(
			entry,
			'import React from "react";\nexport function App({ value }) { return <main>{value}</main>; }\n',
		);
		const outDir = join(directory, "dist");
		const buildResult = await build({
			root: directory,
			logLevel: "silent",
			plugins: [wakameReactPlugin({ tokenizer: createFileRuntimeTokenizer() })],
			build: {
				ssr: entry,
				outDir,
				rollupOptions: {
					external: [/^react(?:\/|$)/],
				},
			},
		});
		type BuildChunk = { type: "chunk"; fileName: string; code: string };
		type BuildOutput = { output: BuildChunk[] };
		const rollupOutputs = (Array.isArray(buildResult) ? buildResult : [buildResult]).flatMap(
			(result) => (result as unknown as BuildOutput).output,
		);
		const chunk = rollupOutputs.find((output) => output.type === "chunk");
		if (chunk === undefined) throw new Error("Expected a Vite SSR output");
		const outputPath = join(outDir, chunk.fileName);
		writeFileSync(outputPath, chunk.code);
		const module = (await import(`${pathToFileURL(outputPath).href}?production`)) as {
			App: ComponentType<{ value: string }>;
		};
		const html = renderToString(React.createElement(module.App, { value: "本番日本語" }));
		expect(html).toContain("本番\u200B日本語");
	});

	test("hydrates dynamic runtime text consistently between server and client", async () => {
		using temporaryDirectory = mkdtempDisposableSync(join(tmpdir(), "wakame-react-dynamic-"));
		const directory = temporaryDirectory.path;
		const nodeModules = join(directory, "node_modules");
		mkdirSync(nodeModules);
		symlinkSync(join(process.cwd(), "node_modules/react"), join(nodeModules, "react"), "dir");
		const entry = join(directory, "App.jsx");
		writeFileSync(
			entry,
			'import React from "react";\nexport function App({ value }) { return <main>{value}</main>; }\n',
		);
		const { tokenizer } = createRuntimeTokenizer();

		async function bundle(platform: "node" | "browser") {
			const build = await rolldown({
				input: entry,
				platform,
				external: [/^react(?:\/|$)/],
				plugins: [runtimeModulePlugin, wakameReactPlugin({ tokenizer })],
				transform: { jsx: "react-jsx" },
			});
			const generated = await build.generate({ format: "esm" });
			const output = generated.output.find((item) => item.type === "chunk");
			if (output === undefined || output.type !== "chunk") throw new Error("Expected a chunk");
			const outputPath = join(directory, `${platform}-dynamic.mjs`);
			writeFileSync(outputPath, output.code);
			return (await import(`${pathToFileURL(outputPath).href}?${platform}-dynamic`)) as {
				App: ComponentType<{ value: string }>;
			};
		}

		const server = await bundle("node");
		const client = await bundle("browser");
		const props = { value: "動的日本語" };
		const serverHtml = renderToString(React.createElement(server.App, props));
		const clientHtml = renderToString(React.createElement(client.App, props));
		expect(serverHtml).toBe(clientHtml);

		const dom = new JSDOM(`<main>${serverHtml}</main>`, { url: "http://localhost/" });
		const previous = new Map([
			["window", Object.getOwnPropertyDescriptor(globalThis, "window")],
			["document", Object.getOwnPropertyDescriptor(globalThis, "document")],
			["navigator", Object.getOwnPropertyDescriptor(globalThis, "navigator")],
		]);
		for (const [key, value] of Object.entries({
			window: dom.window,
			document: dom.window.document,
			navigator: dom.window.navigator,
		})) {
			Object.defineProperty(globalThis, key, {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			});
		}
		const recoverableErrors: unknown[] = [];
		try {
			const container = dom.window.document.querySelector("main");
			if (container === null) throw new Error("Expected a main element");
			hydrateRoot(container, React.createElement(client.App, props), {
				onRecoverableError(error) {
					recoverableErrors.push(error);
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
			expect(recoverableErrors).toEqual([]);
			expect(container.innerHTML).toBe(clientHtml);
		} finally {
			for (const [key, descriptor] of previous) {
				if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[key];
				else Object.defineProperty(globalThis, key, descriptor);
			}
			dom.window.close();
		}
	});

	test("honors include, exclude, node_modules, and dictionary options", async () => {
		const { calls, tokenizer } = createTokenizer((text) => [text.slice(0, 1), text.slice(1)]);
		const options: TransformOptions = {
			tokenizer,
			dictionary: ["固有語"],
			include: "**/*.jsx",
			exclude: "**/skip/**",
		};

		const included = await transform("const x = <div>対象</div>;", "/project/src/App.jsx", options);
		const excluded = await transform(
			"const x = <div>対象</div>;",
			"/project/skip/App.jsx",
			options,
		);
		const dependency = await transform(
			"const x = <div>対象</div>;",
			"/project/node_modules/pkg/index.jsx",
			options,
		);

		expect(requireResult(included).code).toMatch(/\\u200B/);
		expect(excluded).toBeNull();
		expect(dependency).toBeNull();
		expect(calls[0]?.dictionary).toEqual(["固有語"]);
	});

	test("throws when tokenizer output cannot reconstruct text", async () => {
		const { tokenizer } = createTokenizer(() => ["壊れた"]);

		await expect(
			transform("const x = <div>入力</div>;", "/project/src/App.jsx", { tokenizer }),
		).rejects.toThrow(/does not reconstruct JSX text/);
	});

	test("bundles the same transformed component for server and client and hydrates without errors", async () => {
		using temporaryDirectory = mkdtempDisposableSync(join(tmpdir(), "wakame-react-"));
		const directory = temporaryDirectory.path;
		const nodeModules = join(directory, "node_modules");
		mkdirSync(nodeModules);
		symlinkSync(join(process.cwd(), "node_modules/react"), join(nodeModules, "react"), "dir");
		const entry = join(directory, "App.jsx");
		writeFileSync(
			entry,
			'import React from "react";\nexport function App() { return <div id="app">こんにちは世界</div>; }\n',
		);
		const splitTokenizer = () =>
			createTokenizer((text) => (text === "こんにちは世界" ? ["こんにちは", "世界"] : [text]))
				.tokenizer;

		async function bundle(platform: "node" | "browser") {
			const build = await rolldown({
				input: entry,
				platform,
				external: [/^react(?:\/|$)/],
				plugins: [wakameReactPlugin({ tokenizer: splitTokenizer() })],
				transform: { jsx: "react-jsx" },
			});
			const generated = await build.generate({ format: "esm", sourcemap: "inline" });
			const output = generated.output.find((item) => item.type === "chunk");
			if (output === undefined || output.type !== "chunk") {
				throw new Error(`Expected a ${platform} output chunk`);
			}
			const outputPath = join(directory, `${platform}.mjs`);
			writeFileSync(outputPath, output.code);
			return {
				module: (await import(`${pathToFileURL(outputPath).href}?${platform}`)) as {
					App: ComponentType;
				},
				code: output.code,
			};
		}

		const server = await bundle("node");
		const client = await bundle("browser");
		expect(server.code).toContain("\u200B");
		expect(client.code).toContain("\u200B");

		const serverHtml = renderToString(React.createElement(server.module.App));
		const expectedDom = new JSDOM(`<main>${serverHtml}</main>`).window.document.querySelector(
			"main",
		);
		expect(expectedDom).not.toBeNull();

		const dom = new JSDOM(`<main>${serverHtml}</main>`, { url: "http://localhost/" });
		const previous = new Map([
			["window", Object.getOwnPropertyDescriptor(globalThis, "window")],
			["document", Object.getOwnPropertyDescriptor(globalThis, "document")],
			["navigator", Object.getOwnPropertyDescriptor(globalThis, "navigator")],
		]);
		for (const [key, value] of Object.entries({
			window: dom.window,
			document: dom.window.document,
			navigator: dom.window.navigator,
		})) {
			Object.defineProperty(globalThis, key, {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			});
		}
		const recoverableErrors: unknown[] = [];
		try {
			const container = dom.window.document.querySelector("main");
			expect(container).not.toBeNull();
			if (container === null || expectedDom === null) throw new Error("Expected a main element");
			hydrateRoot(container, React.createElement(client.module.App), {
				onRecoverableError(error) {
					recoverableErrors.push(error);
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
			expect(recoverableErrors).toEqual([]);
			expect(container.innerHTML).toBe(expectedDom.innerHTML);
		} finally {
			for (const [key, descriptor] of previous) {
				if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[key];
				else Object.defineProperty(globalThis, key, descriptor);
			}
			dom.window.close();
		}
	});
});
