import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { JSDOM } from "jsdom";
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { rolldown } from "rolldown";
import wakameReactPlugin from "../dist/index.js";

function createTokenizer(splitText = (text) => [text]) {
	const calls = [];
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

async function transform(source, id = "/project/src/App.jsx", options = {}) {
	const plugin = wakameReactPlugin({
		tokenizer: options.tokenizer ?? createTokenizer().tokenizer,
		...options,
	});
	return plugin.transform.handler(source, id);
}

await test("normalizes JSX whitespace and decodes entities through Babel builders", async () => {
	const { calls, tokenizer } = createTokenizer((text) =>
		text === "こんにちは & 世界" ? ["こんにちは & ", "世界"] : [text],
	);
	const result = await transform(
		"const view = <div>\n  こんにちは &amp; 世界\n</div>;",
		"/project/src/App.jsx",
		{ tokenizer },
	);

	assert.equal(calls[0].text, "こんにちは & 世界");
	assert.match(result.code, /\\u3053\\u3093\\u306B\\u3061\\u306F &/);
	assert.match(result.code, /<wbr\s*\/>/);
});

await test("transforms direct string literal JSX expressions", async () => {
	const { tokenizer } = createTokenizer((text) =>
		text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
	);
	const result = await transform(
		'const view = <div>{"こんにちは世界"}</div>;',
		"/project/src/App.jsx",
		{ tokenizer },
	);

	assert.match(
		result.code,
		/\{"\\u3053\\u3093\\u306B\\u3061\\u306F"\}<wbr \/>\{"\\u4E16\\u754C"\}/,
	);
});

await test("parses TSX and returns a source map", async () => {
	const { tokenizer } = createTokenizer((text) =>
		text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
	);
	const result = await transform(
		"type Props = {};\nexport const View = (_props: Props) => <div>こんにちは世界</div>;",
		"/project/src/View.tsx",
		{ tokenizer },
	);

	assert.equal(result.map.version, 3);
	assert.deepEqual(result.map.sources, ["/project/src/View.tsx"]);
	assert.match(result.code, /<wbr \/>/);
});

await test("ignores empty tokens when creating break opportunities", async () => {
	const { tokenizer } = createTokenizer((text) =>
		text === "日本語" ? ["", "日本", "語"] : [text],
	);
	const result = await transform("const view = <div>日本語</div>;", "/project/src/App.jsx", {
		tokenizer,
	});

	assert.match(result.code, /\{"\\u65E5\\u672C"\}<wbr \/>\{"\\u8A9E"\}/);
	assert.doesNotMatch(result.code, /<div><wbr \/>/);
});

await test("accepts additional Babel parser plugins for decorators", async () => {
	const { tokenizer } = createTokenizer((text) =>
		text === "こんにちは世界" ? ["こんにちは", "世界"] : [text],
	);
	const result = await transform(
		"@sealed class Model {}\nexport const view = <div>こんにちは世界</div>;",
		"/project/src/View.tsx",
		{ tokenizer, parserPlugins: ["decorators-legacy"] },
	);

	assert.match(result.code, /<wbr \/>/);
});

await test("does not transform dynamic, cross-child, custom, foreign, or restricted content", async () => {
	const { calls, tokenizer } = createTokenizer((text) => [text.slice(0, 1), text.slice(1)]);
	const result = await transform(
		`const dynamic = "動的";
const portalTarget = document.body;
const view = <>
  <div>{dynamic}</div>
	  <div>{\`テンプレート\`}</div>
  <div>インライン<span>跨ぎ</span>本文</div>
  <MyComponent><div>カスタム配下</div></MyComponent>
  <Namespace.Component>メンバー配下</Namespace.Component>
  <svg><text>SVG</text></svg>
  <math><mi>Math</mi></math>
  <table><tbody><tr><td>Table</td></tr></tbody></table>
  <div contentEditable>編集可能</div>
  <div dangerouslySetInnerHTML={{ __html: "危険" }} />
  <div data-wakame-ignore>除外</div>
  {createPortal("Portal", portalTarget)}
  <pre>Pre</pre><code>Code</code>
</>;`,
		"/project/src/App.jsx",
		{ tokenizer },
	);

	assert.match(result.code, /<MyComponent><div>カスタム配下<\/div><\/MyComponent>/);
	assert.doesNotMatch(result.code, /カスタム配下<\/div><wbr/);
	assert.match(result.code, /<svg><text>SVG<\/text><\/svg>/);
	assert.match(result.code, /<table><tbody><tr><td>Table<\/td><\/tr><\/tbody><\/table>/);
	assert.equal(
		calls.some(({ text }) => text === "Portal"),
		false,
	);
	assert.equal(
		calls.some(({ text }) => text === "編集可能"),
		false,
	);
	assert.equal(
		calls.some(({ text }) => text === "インライン跨ぎ本文"),
		false,
	);
});

await test("honors include, exclude, node_modules, and dictionary options", async () => {
	const { calls, tokenizer } = createTokenizer((text) => [text.slice(0, 1), text.slice(1)]);
	const options = {
		tokenizer,
		dictionary: ["固有語"],
		include: "**/*.jsx",
		exclude: "**/skip/**",
	};

	const included = await transform("const x = <div>対象</div>;", "/project/src/App.jsx", options);
	const excluded = await transform("const x = <div>対象</div>;", "/project/skip/App.jsx", options);
	const dependency = await transform(
		"const x = <div>対象</div>;",
		"/project/node_modules/pkg/index.jsx",
		options,
	);

	assert.match(included.code, /<wbr \/>/);
	assert.equal(excluded, null);
	assert.equal(dependency, null);
	assert.deepEqual(calls[0].dictionary, ["固有語"]);
});

await test("throws when tokenizer output cannot reconstruct text", async () => {
	const { tokenizer } = createTokenizer(() => ["壊れた"]);

	await assert.rejects(
		transform("const x = <div>入力</div>;", "/project/src/App.jsx", { tokenizer }),
		/does not reconstruct JSX text/,
	);
});

await test("bundles the same transformed component for server and client and hydrates without errors", async () => {
	const directory = await mkdtemp(join(process.cwd(), ".wakame-react-"));
	const entry = join(directory, "App.jsx");
	await writeFile(
		entry,
		'import React from "react";\nexport function App() { return <div id="app">こんにちは世界</div>; }\n',
	);
	const splitTokenizer = () =>
		createTokenizer((text) => (text === "こんにちは世界" ? ["こんにちは", "世界"] : [text]))
			.tokenizer;

	async function bundle(platform) {
		const build = await rolldown({
			input: entry,
			platform,
			external: [/^react(?:\/|$)/],
			plugins: [wakameReactPlugin({ tokenizer: splitTokenizer() })],
			transform: { jsx: "react-jsx" },
		});
		const generated = await build.generate({ format: "esm", sourcemap: true });
		const output = generated.output.find((item) => item.type === "chunk");
		assert.ok(output);
		const outputPath = join(directory, `${platform}.mjs`);
		await writeFile(outputPath, output.code);
		return {
			module: await import(`${pathToFileURL(outputPath).href}?${platform}`),
			code: output.code,
		};
	}

	const server = await bundle("node");
	const client = await bundle("browser");
	assert.match(server.code, /wbr/);
	assert.match(client.code, /wbr/);

	const serverHtml = renderToString(React.createElement(server.module.App));
	const expectedDom = new JSDOM(`<main>${serverHtml}</main>`).window.document.querySelector("main");
	assert.ok(expectedDom);

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
	const recoverableErrors = [];
	try {
		const container = dom.window.document.querySelector("main");
		assert.ok(container);
		hydrateRoot(container, React.createElement(client.module.App), {
			onRecoverableError(error) {
				recoverableErrors.push(error);
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(recoverableErrors, []);
		assert.equal(container.innerHTML, expectedDom.innerHTML);
	} finally {
		for (const [key, descriptor] of previous) {
			if (descriptor === undefined) delete globalThis[key];
			else Object.defineProperty(globalThis, key, descriptor);
		}
		dom.window.close();
	}
	await rm(directory, { recursive: true, force: true });
});
