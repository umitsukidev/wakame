import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWakame } from "@wakamejs/core";
import { describe, expect, it } from "vitest";
import wakameIntegration, { transformHtml } from "../dist/index.js";

const characterTokenizer = { tokenize: async (text) => Array.from(text) };
const singleTokenTokenizer = { tokenize: async (text) => [text] };
const characterWakame = createWakame({ tokenizer: characterTokenizer });
const singleTokenWakame = createWakame({ tokenizer: singleTokenTokenizer });

async function withOutputDirectory(run) {
	const root = await mkdtemp(join(tmpdir(), "wakame-body-test-"));
	try {
		return await run(pathToFileURL(`${root}${sep}`));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeOutputFile(directory, relativePath, contents) {
	const path = join(fileURLToPath(directory), relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
	return path;
}

function buildDone(integration, dir) {
	return integration.hooks["astro:build:done"]({ dir, logger: { info: () => {} } });
}

function pageWithHeadAndBody() {
	const prefix =
		"<!doctype html><!-- <body id='fake-comment'> --><html lang='ja'><head><style>.x::after{content:\"<body id='fake-style'>\"}</style><script>const fake = \"<body>\";</script><template><body id='fake-template'>ignored</body></template></head>";
	const bodyStart = "<body id='page' data-note='a&amp;b > c' style='color: red'>";
	const bodyContents = "直<wbr>接の日本語<p>本文の文章</p>";
	const suffix = "</body>\n\t</html><!-- keep the tail -->";
	return {
		prefix,
		bodyStart,
		bodyContents,
		suffix,
		source: prefix + bodyStart + bodyContents + suffix,
	};
}

async function runDevMiddleware(integration, source) {
	let middleware;
	integration.hooks["astro:server:setup"]({
		server: {
			middlewares: {
				use(handler) {
					middleware = handler;
				},
			},
		},
	});
	if (!middleware) throw new Error("Astro middleware was not registered");

	const server = createServer((request, response) => {
		middleware(request, response, () => {
			response.writeHead(200, { "content-type": "text/html" });
			response.end(source);
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Unexpected server address");
		const response = await fetch(`http://127.0.0.1:${address.port}/`);
		return await response.text();
	} finally {
		await new Promise((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
}

describe("body-only HTML transformation", () => {
	it("keeps head and trailing source intact and preserves body attributes", async () => {
		const { prefix, suffix, source } = pageWithHeadAndBody();
		const output = await transformHtml(source, characterWakame, true, {
			bodyOnly: true,
			preserveExistingWbr: false,
		});

		expect(output.startsWith(prefix)).toBe(true);
		expect(output.endsWith(suffix)).toBe(true);
		expect(output).toContain('id="page"');
		expect(output).toContain('data-note="a&amp;b > c"');
		expect(output).toContain('style="color: red; word-break: keep-all; overflow-wrap: anywhere;"');
		expect(output).toMatch(/直<wbr>接/);
	});

	it("removes existing wbr elements from the body fragment when requested", async () => {
		const source = "<html><head></head><body><p>日<wbr>本語</p></body></html>";
		const output = await transformHtml(source, singleTokenWakame, false, {
			bodyOnly: true,
			preserveExistingWbr: false,
		});

		expect(output).not.toContain("<wbr");
	});

	it.each([
		["no explicit body", "<!doctype html><h1>日本語</h1>"],
		[
			"content that implicitly creates a body first",
			"<html><div>前の本文</div><body><p>日本語</p></body></html>",
		],
		["an unclosed body", "<html><head><title>見出し</title></head><body><p>日本語"],
		[
			"an unclosed element at the body end",
			"<html><head></head><body><div><p>日本語</body></html>",
		],
		[
			"content after the body end tag",
			"<html><head></head><body><p>日本語</p></body><section>後続の本文</section></html>",
		],
	])("uses full-document parsing for %s", async (_description, source) => {
		const expected = await transformHtml(source, characterWakame, true, {
			preserveExistingWbr: false,
		});
		const actual = await transformHtml(source, characterWakame, true, {
			bodyOnly: true,
			preserveExistingWbr: false,
		});

		expect(actual).toBe(expected);
	});

	it("uses the body-only path during Astro builds", async () => {
		const { prefix, suffix, source } = pageWithHeadAndBody();
		await withOutputDirectory(async (dir) => {
			const path = await writeOutputFile(dir, "index.html", source);
			await buildDone(wakameIntegration({ tokenizer: characterTokenizer }), dir);

			const output = await readFile(path, "utf8");
			expect(output.startsWith(prefix)).toBe(true);
			expect(output.endsWith(suffix)).toBe(true);
			expect(output).toContain("<wbr>");
		});
	});

	it("uses the body-only path for Astro dev responses", async () => {
		const { prefix, suffix, source } = pageWithHeadAndBody();
		const output = await runDevMiddleware(
			wakameIntegration({ tokenizer: characterTokenizer }),
			source,
		);

		expect(output.startsWith(prefix)).toBe(true);
		expect(output.endsWith(suffix)).toBe(true);
		expect(output).toContain("<wbr>");
	});
});
