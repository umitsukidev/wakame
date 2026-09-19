import { mkdtempDisposableSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import React, { type ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { rolldown } from "rolldown";
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
		expect(result.code).toMatch(/<wbr\s*\/>/);
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

		expect(result.code).toMatch(
			/\{"\\u3053\\u3093\\u306B\\u3061\\u306F"\}<wbr \/>\{"\\u4E16\\u754C"\}/,
		);
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
		expect(result.code).toMatch(/<wbr \/>/);
	});

	test("ignores empty tokens when creating break opportunities", async () => {
		const { tokenizer } = createTokenizer((text) =>
			text === "日本語" ? ["", "日本", "語"] : [text],
		);
		const result = requireResult(
			await transform("const view = <div>日本語</div>;", "/project/src/App.jsx", { tokenizer }),
		);

		expect(result.code).toMatch(/\{"\\u65E5\\u672C"\}<wbr \/>\{"\\u8A9E"\}/);
		expect(result.code).not.toMatch(/<div><wbr \/>/);
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

		expect(result.code).toMatch(/<wbr \/>/);
	});

	test("does not join text across inline JSX children or transform excluded content", async () => {
		const { calls, tokenizer } = createTokenizer((text) => [text.slice(0, 1), text.slice(1)]);
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
  <div data-wakame-ignore>除外</div>
  {createPortal(<div>Portal</div>, portalTarget)}
  <pre>Pre</pre><code>Code</code>
</>;`,
				"/project/src/App.jsx",
				{ tokenizer },
			),
		);

		expect(result.code).toMatch(/<MyComponent><div>カスタム配下<\/div><\/MyComponent>/);
		expect(result.code).not.toMatch(/カスタム配下<\/div><wbr/);
		expect(result.code).toMatch(/<svg><text>SVG<\/text><\/svg>/);
		expect(result.code).toMatch(/<table><tbody><tr><td>Table<\/td><\/tr><\/tbody><\/table>/);
		expect(calls.some(({ text }) => text === "Portal")).toBe(false);
		expect(calls.some(({ text }) => text === "編集可能")).toBe(false);
		expect(calls.some(({ text }) => text === "インライン跨ぎ本文")).toBe(false);
		expect(calls.some(({ text }) => text === "インライン")).toBe(true);
		expect(calls.some(({ text }) => text === "跨ぎ")).toBe(true);
		expect(calls.some(({ text }) => text === "本文")).toBe(true);
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

		expect(requireResult(included).code).toMatch(/<wbr \/>/);
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
		expect(server.code).toMatch(/wbr/);
		expect(client.code).toMatch(/wbr/);

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
