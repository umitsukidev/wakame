import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import wakameIntegration from "../dist/index.js";

const emptyTokenizer = { tokenize: async (text) => [text] };

async function withOutputDirectory(run) {
	const root = await mkdtemp(join(tmpdir(), "wakame-astro-test-"));
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

function buildDone(integration, dir, messages = []) {
	return integration.hooks["astro:build:done"]({
		dir,
		logger: { info: (message) => messages.push(message) },
	});
}

function characterTokenizer() {
	let active = 0;
	let maximumActive = 0;
	let calls = 0;
	return {
		tokenizer: {
			async tokenize(text) {
				calls++;
				active++;
				maximumActive = Math.max(maximumActive, active);
				try {
					await Promise.resolve();
					return Array.from(text);
				} finally {
					active--;
				}
			},
		},
		get calls() {
			return calls;
		},
		get maximumActive() {
			return maximumActive;
		},
	};
}

function barrierCharacterTokenizer(barrierSize) {
	let active = 0;
	let maximumActive = 0;
	let calls = 0;
	let releaseBarrier;
	let timeout;
	const barrier = new Promise((resolve, reject) => {
		releaseBarrier = resolve;
		timeout = setTimeout(() => reject(new Error("concurrency barrier timed out")), 1000);
	});
	return {
		tokenizer: {
			async tokenize(text) {
				calls++;
				active++;
				maximumActive = Math.max(maximumActive, active);
				if (active === barrierSize) {
					clearTimeout(timeout);
					releaseBarrier();
				}
				try {
					await barrier;
					return Array.from(text);
				} finally {
					active--;
				}
			},
		},
		get calls() {
			return calls;
		},
		get maximumActive() {
			return maximumActive;
		},
	};
}

await test(
	"default concurrency overlaps files with one shared limit across nested directories",
	{ timeout: 2000 },
	async () => {
		await withOutputDirectory(async (dir) => {
			const files = [
				"root-one.html",
				"root-two.html",
				"nested/one.html",
				"nested/deep/two.html",
				"other/three.html",
				"other/four.html",
			];
			for (const [index, relativePath] of files.entries()) {
				await writeOutputFile(
					dir,
					relativePath,
					`<html><body><p>日本語の文章${index}</p></body></html>`,
				);
			}

			const tokenizer = barrierCharacterTokenizer(4);
			const messages = [];
			await buildDone(wakameIntegration({ tokenizer: tokenizer.tokenizer }), dir, messages);

			assert.equal(tokenizer.calls, files.length);
			assert.equal(tokenizer.maximumActive, 4);
			assert.deepEqual(messages, ["HTML transformation completed."]);
		});
	},
);

await test("buildConcurrency 1 keeps HTML file processing serial", async () => {
	await withOutputDirectory(async (dir) => {
		for (const relativePath of ["one.html", "nested/two.html", "nested/deep/three.html"]) {
			await writeOutputFile(dir, relativePath, "<html><body><p>日本語</p></body></html>");
		}

		const tokenizer = characterTokenizer();
		await buildDone(
			wakameIntegration({ tokenizer: tokenizer.tokenizer, buildConcurrency: 1 }),
			dir,
		);

		assert.equal(tokenizer.maximumActive, 1);
		assert.equal(tokenizer.calls, 3);
	});
});

await test("parallel output matches serial output and handles encoded paths and untouched files", async () => {
	const relativePath = "nested 日本語 & #%/page 日本語 & #%.html";
	const source = "<html><body><p>日<wbr>本語</p></body></html>";
	const binary = Buffer.from([0, 255, 1, 32]);
	let serialOutput;
	let parallelOutput;

	for (const [concurrency, saveOutput] of [
		[1, (output) => (serialOutput = output)],
		[3, (output) => (parallelOutput = output)],
	]) {
		await withOutputDirectory(async (dir) => {
			const htmlPath = await writeOutputFile(dir, relativePath, source);
			const binaryPath = await writeOutputFile(dir, "assets/file.bin", binary);
			const textPath = await writeOutputFile(dir, "notes.txt", "leave this alone");

			await buildDone(
				wakameIntegration({
					tokenizer: emptyTokenizer,
					applyWrapStyle: false,
					buildConcurrency: concurrency,
				}),
				dir,
			);

			const output = await readFile(htmlPath, "utf8");
			assert.equal(output.includes("<wbr"), false);
			assert.equal(output.includes("word-break:"), false);
			assert.deepEqual(await readFile(binaryPath), binary);
			assert.equal(await readFile(textPath, "utf8"), "leave this alone");
			saveOutput(output);
		});
	}

	assert.equal(parallelOutput, serialOutput);
});

await test("parallel transformation preserves wbr insertion and wrapping styles", async () => {
	const files = new Map([
		["index.html", "<html><body><p>日本語の文章</p><p>別の段落</p></body></html>"],
		["nested/guide.html", "<html><body><p>折<wbr>り返し</p></body></html>"],
		["deep/path/page 日本語&.html", "<html><body><p>並列変換</p></body></html>"],
	]);

	const transformFiles = async (buildConcurrency) =>
		withOutputDirectory(async (dir) => {
			for (const [relativePath, contents] of files) {
				await writeOutputFile(dir, relativePath, contents);
			}
			const tokenizer = characterTokenizer();
			await buildDone(wakameIntegration({ tokenizer: tokenizer.tokenizer, buildConcurrency }), dir);

			const outputs = new Map();
			for (const relativePath of files.keys()) {
				const output = await readFile(join(fileURLToPath(dir), relativePath), "utf8");
				assert.match(output, /<wbr>/);
				assert.match(output, /word-break: keep-all; overflow-wrap: anywhere;/);
				outputs.set(relativePath, output);
			}
			return outputs;
		});

	const serialOutputs = await transformFiles(1);
	const parallelOutputs = await transformFiles(3);
	for (const [relativePath, output] of serialOutputs) {
		assert.equal(parallelOutputs.get(relativePath), output);
	}
});

await test("invalid buildConcurrency values fail when the integration is created", () => {
	for (const buildConcurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
		assert.throws(() => wakameIntegration({ tokenizer: emptyTokenizer, buildConcurrency }), {
			name: "RangeError",
			message: "buildConcurrency must be a positive safe integer",
		});
	}
});

await test("a file failure stops dequeueing, waits for active work, and rejects without logging success", async () => {
	await withOutputDirectory(async (dir) => {
		const paths = [
			["failure.html", "failure"],
			["pending.html", "pending"],
			["queued.html", "queued"],
		];
		const original = new Map();
		for (const [relativePath, text] of paths) {
			const contents = `<html><body><p>${text}</p></body></html>`;
			original.set(relativePath, contents);
			await writeOutputFile(dir, relativePath, contents);
		}

		let calls = 0;
		const failingTokenizerError = new Error("tokenizer failed");
		let startPending;
		let signalFailure;
		let releasePending;
		const pendingStarted = new Promise((resolve) => (startPending = resolve));
		const failureStarted = new Promise((resolve) => (signalFailure = resolve));
		const pendingRelease = new Promise((resolve) => (releasePending = resolve));
		const tokenizer = {
			async tokenize(text) {
				calls++;
				if (text === "failure") {
					await pendingStarted;
					signalFailure();
					throw failingTokenizerError;
				}
				startPending();
				await pendingRelease;
				return Array.from(text);
			},
		};
		const messages = [];
		let buildSettled = false;
		const buildPromise = buildDone(
			wakameIntegration({ tokenizer, buildConcurrency: 2 }),
			dir,
			messages,
		).finally(() => {
			buildSettled = true;
		});

		await failureStarted;
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(buildSettled, false);
		assert.equal(calls, 2);

		releasePending();
		await assert.rejects(buildPromise, (error) => error === failingTokenizerError);
		assert.equal(calls, 2);
		assert.deepEqual(messages, []);

		let changedHtmlFiles = 0;
		for (const [relativePath, text] of paths) {
			const output = await readFile(join(fileURLToPath(dir), relativePath), "utf8");
			if (output !== original.get(relativePath)) changedHtmlFiles++;
			if (text === "queued") assert.equal(output, original.get(relativePath));
		}
		assert.equal(changedHtmlFiles, 1);
	});
});
