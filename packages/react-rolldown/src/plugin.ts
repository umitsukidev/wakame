import generateModule from "@babel/generator";
import { parse, type ParserPlugin } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import {
	and,
	id,
	include,
	interpreter,
	not,
	or,
	type TopLevelFilterExpression,
} from "@rolldown/pluginutils";
import {
	createWakame,
	type DictionaryInput,
	type RuntimeTokenizerDescriptor,
	type Tokenizer,
} from "@wakamejs/core";
import type { Plugin, SourceMapInput } from "rolldown";

const generate = ((
	generateModule as unknown as { default?: typeof import("@babel/generator").default }
).default ?? generateModule) as unknown as typeof import("@babel/generator").default;
const traverse = ((
	traverseModule as unknown as { default?: typeof import("@babel/traverse").default }
).default ?? traverseModule) as unknown as typeof import("@babel/traverse").default;

export type ReactRolldownFilterPattern = string | RegExp | readonly (string | RegExp)[];

export interface ReactRolldownPluginOptions {
	tokenizer: Tokenizer<string, string>;
	dictionary?: DictionaryInput<string>;
	include?: ReactRolldownFilterPattern;
	exclude?: ReactRolldownFilterPattern;
	ignoreAttribute?: string;
	ignore?: readonly string[];
	parserPlugins?: readonly ParserPlugin[];
}

export type ReactRolldownPlugin = Plugin & { enforce: "pre" };

interface StaticCandidate {
	path: NodePath<t.JSXText | t.JSXExpressionContainer>;
	semanticText: string;
}

interface DynamicCandidate {
	path: NodePath<t.JSXExpressionContainer>;
}

interface CollectedCandidates {
	staticCandidates: StaticCandidate[];
	dynamicCandidates: DynamicCandidate[];
}

const defaultSourcePattern = /\.[jt]sx(?:$|\?)/;
const nodeModulesPattern = /(?:^|\/)node_modules(?:\/|$)/;
const zeroWidthSpace = "\u200B";
const runtimeRequest = "virtual:@wakamejs/react-rolldown/runtime";
const runtimeId = `\0${runtimeRequest}`;

const skipElements = new Set([
	"area",
	"base",
	"basefont",
	"datalist",
	"head",
	"link",
	"meta",
	"noembed",
	"noframes",
	"param",
	"rp",
	"script",
	"style",
	"template",
	"title",
	"noscript",
	"listing",
	"plaintext",
	"pre",
	"xmp",
	"rt",
	"input",
	"select",
	"button",
	"textarea",
	"abbr",
	"code",
	"iframe",
	"time",
	"var",
	"svg",
	"math",
	"br",
	"hr",
	"wbr",
]);

const restrictedElements = new Set([
	"table",
	"caption",
	"col",
	"colgroup",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
]);

function asPatterns(pattern: ReactRolldownFilterPattern): readonly (string | RegExp)[] {
	if (typeof pattern === "string" || pattern instanceof RegExp) return [pattern];
	return pattern;
}

function globToRegExp(pattern: string): RegExp {
	const normalized = pattern.replaceAll("\\", "/");
	let source = "^";
	let index = 0;
	while (index < normalized.length) {
		const character = normalized[index];
		if (character === undefined) break;
		if (character === "*" && normalized[index + 1] === "*") {
			if (normalized[index + 2] === "/") {
				source += "(?:.*/)?";
				index += 3;
			} else {
				source += ".*";
				index += 2;
			}
			continue;
		}
		if (character === "*") {
			source += "[^/]*";
			index++;
			continue;
		}
		if (character === "?") {
			source += "[^/]";
			index++;
			continue;
		}
		if ("\\^$+?.()|{}[]".includes(character)) source += `\\${character}`;
		else source += character;
		index++;
	}
	return new RegExp(`${source}$`);
}

function filterPattern(pattern: string | RegExp): string | RegExp {
	return typeof pattern === "string" ? globToRegExp(pattern) : pattern;
}

function createIdExpression(patterns: readonly (string | RegExp)[]) {
	return or(...patterns.map((pattern) => id(filterPattern(pattern))));
}

function createTransformFilter(options: ReactRolldownPluginOptions): TopLevelFilterExpression[] {
	const includes = asPatterns(options.include ?? defaultSourcePattern);
	const excludes = [nodeModulesPattern, ...(options.exclude ? asPatterns(options.exclude) : [])];

	return [include(and(createIdExpression(includes), not(createIdExpression(excludes))))];
}

function memberElementName(name: t.JSXIdentifier | t.JSXMemberExpression): string {
	return t.isJSXIdentifier(name)
		? name.name
		: `${memberElementName(name.object)}.${name.property.name}`;
}

function elementName(element: t.JSXOpeningElement): string {
	const name = element.name;
	if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
	return memberElementName(name);
}

function hasOptOutAttribute(element: t.JSXOpeningElement, ignoreAttribute: string): boolean {
	return element.attributes.some((attribute) => {
		if (!t.isJSXAttribute(attribute)) return false;
		if (!t.isJSXIdentifier(attribute.name)) return false;
		const name = attribute.name.name;
		return (
			name === ignoreAttribute ||
			name.toLowerCase() === "contenteditable" ||
			name.toLowerCase() === "dangerouslysetinnerhtml"
		);
	});
}

function shouldSkipSubtree(
	element: t.JSXElement,
	ignoreAttribute: string,
	ignoredComponents: ReadonlySet<string>,
): boolean {
	if (hasOptOutAttribute(element.openingElement, ignoreAttribute)) return true;
	const openingName = element.openingElement.name;
	const name = elementName(element.openingElement);
	if (ignoredComponents.has(name)) return true;
	return t.isJSXIdentifier(openingName) && (skipElements.has(name) || restrictedElements.has(name));
}

function buildSemanticText(node: t.JSXText | t.JSXExpressionContainer): string | undefined {
	const child = t.cloneNode(node, true);
	const fragment = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), [child]);
	const normalizedChildren = t.react.buildChildren(fragment);
	if (normalizedChildren.length !== 1) return undefined;
	const normalized = normalizedChildren[0];
	return t.isStringLiteral(normalized) ? normalized.value : undefined;
}

function isPortalCallee(callee: t.CallExpression["callee"]): boolean {
	if (t.isIdentifier(callee)) return callee.name === "createPortal";
	if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return false;
	if (!t.isIdentifier(callee.property) || callee.property.name !== "createPortal") return false;
	return (
		t.isIdentifier(callee.object) &&
		(callee.object.name === "ReactDOM" || callee.object.name === "React")
	);
}

function collectDirectCandidates(
	children: NodePath<t.JSXElement["children"][number]>[],
	staticCandidates: StaticCandidate[],
	dynamicCandidates: DynamicCandidate[],
): void {
	for (const childPath of children) {
		if (childPath.isJSXText()) {
			const semanticText = buildSemanticText(childPath.node);
			if (semanticText) staticCandidates.push({ path: childPath, semanticText });
			continue;
		}
		if (!childPath.isJSXExpressionContainer()) continue;
		if (t.isJSXEmptyExpression(childPath.node.expression)) continue;
		if (t.isStringLiteral(childPath.node.expression)) {
			const semanticText = buildSemanticText(childPath.node);
			if (semanticText) staticCandidates.push({ path: childPath, semanticText });
			continue;
		}
		dynamicCandidates.push({ path: childPath });
	}
}

function collectCandidates(
	ast: t.File,
	ignoreAttribute: string,
	ignoredComponents: ReadonlySet<string>,
): CollectedCandidates {
	const staticCandidates: StaticCandidate[] = [];
	const dynamicCandidates: DynamicCandidate[] = [];
	traverse(ast, {
		CallExpression(path) {
			if (isPortalCallee(path.node.callee)) path.skip();
		},
		JSXElement(path) {
			if (shouldSkipSubtree(path.node, ignoreAttribute, ignoredComponents)) {
				path.skip();
				return;
			}
			collectDirectCandidates(path.get("children"), staticCandidates, dynamicCandidates);
		},
		JSXFragment(path) {
			collectDirectCandidates(path.get("children"), staticCandidates, dynamicCandidates);
		},
	});
	return { staticCandidates, dynamicCandidates };
}

function createStaticReplacement(tokens: readonly string[]): t.JSXExpressionContainer | undefined {
	const nonEmptyTokens = tokens.filter((token) => token.length > 0);
	if (nonEmptyTokens.length < 2) return undefined;
	let text = "";
	for (const token of nonEmptyTokens) {
		if (text.length > 0 && !text.endsWith(zeroWidthSpace) && !token.startsWith(zeroWidthSpace)) {
			text += zeroWidthSpace;
		}
		text += token;
	}
	return t.jsxExpressionContainer(t.stringLiteral(text));
}

function runtimeFactoryImport(descriptor: RuntimeTokenizerDescriptor): string {
	if (descriptor.export === "default")
		return `import __wakameFactory from ${JSON.stringify(descriptor.module)};`;
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(descriptor.export)) {
		throw new Error(
			`@wakamejs/react-rolldown runtime export must be an identifier or "default"; received ${JSON.stringify(descriptor.export)}`,
		);
	}
	return `import { ${descriptor.export} as __wakameFactory } from ${JSON.stringify(descriptor.module)};`;
}

function createRuntimeModule(
	descriptor: RuntimeTokenizerDescriptor,
	dictionary: readonly string[],
): string {
	const options = descriptor.options === undefined ? "" : JSON.stringify(descriptor.options);
	if (options === undefined) {
		throw new Error("@wakamejs/react-rolldown runtime options must be JSON-serializable.");
	}
	const factoryOptions = options === "" ? "undefined" : options;
	const context = JSON.stringify({ dictionary });
	const factoryCall = `__wakameFactory(${factoryOptions}, ${context})`;
	return [
		runtimeFactoryImport(descriptor),
		`const __wakameSegmenter = ${factoryCall};`,
		`const __wakameZeroWidthSpace = ${JSON.stringify(zeroWidthSpace)};`,
		"function __wakameProcess(value) {",
		'\tif (typeof value === "string") {',
		"\t\tif (value.includes(__wakameZeroWidthSpace)) return value;",
		"\t\tconst tokens = __wakameSegmenter.segment(value);",
		'\t\tif (!Array.isArray(tokens) || tokens.some((token) => typeof token !== "string")) {',
		'\t\t\tthrow new Error("Wakame runtime tokenizer must return an array of strings.");',
		"\t\t}",
		"\t\tconst nonEmptyTokens = tokens.filter((token) => token.length > 0);",
		'\t\tif (nonEmptyTokens.join("") !== value) {',
		'\t\t\tthrow new Error("Wakame runtime tokenizer output does not reconstruct JSX text.");',
		"\t\t}",
		"\t\treturn nonEmptyTokens.length > 1 ? nonEmptyTokens.join(__wakameZeroWidthSpace) : value;",
		"\t}",
		"\tif (Array.isArray(value)) return value.map(__wakameProcess);",
		"\treturn value;",
		"}",
		"export default __wakameProcess;",
	].join("\n");
}

async function transformSource(
	code: string,
	id: string,
	wakame: ReturnType<typeof createWakame<string, string>>,
	runtime: RuntimeTokenizerDescriptor | undefined,
	ignoreAttribute: string,
	ignoredComponents: ReadonlySet<string>,
	parserPlugins: readonly ParserPlugin[],
): Promise<{ code: string; map: SourceMapInput } | null> {
	const isTsx = /\.tsx(?:$|\?)/.test(id);
	const plugins: ParserPlugin[] = [
		"jsx",
		...(isTsx ? ["typescript" as const] : []),
		...parserPlugins,
	];
	const ast = parse(code, {
		sourceType: "module",
		plugins,
	});
	const { staticCandidates, dynamicCandidates } = collectCandidates(
		ast,
		ignoreAttribute,
		ignoredComponents,
	);
	if (staticCandidates.length === 0 && dynamicCandidates.length === 0) return null;
	if (dynamicCandidates.length > 0 && runtime === undefined) {
		throw new Error(
			"@wakamejs/react-rolldown cannot transform dynamic JSX text because the tokenizer does not provide a runtime descriptor. Use a tokenizer with runtime support or make the text static.",
		);
	}

	const transformed: Array<{ candidate: StaticCandidate; replacement: t.JSXExpressionContainer }> =
		[];
	for (const candidate of staticCandidates) {
		const tokens = await wakame.tokenize(candidate.semanticText);
		const restored = tokens.join("");
		if (restored !== candidate.semanticText) {
			throw new Error(
				`Wakame tokenizer output does not reconstruct JSX text (expected ${JSON.stringify(candidate.semanticText)}, received ${JSON.stringify(restored)})`,
			);
		}
		const replacement = createStaticReplacement(tokens);
		if (replacement !== undefined) transformed.push({ candidate, replacement });
	}

	if (dynamicCandidates.length > 0) {
		const firstDynamic = dynamicCandidates[0];
		if (firstDynamic === undefined) throw new Error("Expected a dynamic JSX candidate.");
		const runtimeIdentifier = firstDynamic.path.scope.generateUidIdentifier("wakameRuntime");
		ast.program.body.unshift(
			t.importDeclaration(
				[t.importDefaultSpecifier(runtimeIdentifier)],
				t.stringLiteral(runtimeRequest),
			),
		);
		for (const candidate of dynamicCandidates) {
			const expression = candidate.path.node.expression;
			if (!t.isExpression(expression)) continue;
			candidate.path.node.expression = t.callExpression(t.cloneNode(runtimeIdentifier), [
				expression,
			]);
		}
	}

	transformed.sort(
		(left, right) => (right.candidate.path.node.start ?? 0) - (left.candidate.path.node.start ?? 0),
	);
	for (const { candidate, replacement } of transformed) {
		candidate.path.replaceWith(replacement);
	}
	if (transformed.length === 0 && dynamicCandidates.length === 0) return null;

	const generated = generate(ast, { sourceMaps: true, sourceFileName: id }, code);
	return { code: generated.code, map: generated.map };
}

/** Create an SSR-safe React transform plugin for Rolldown and Vite. */
export function wakameReactPlugin(options: ReactRolldownPluginOptions): ReactRolldownPlugin {
	const dictionary = [...new Set(options.dictionary ?? [])];
	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary,
	});
	const runtime = options.tokenizer.runtime;
	const runtimeModule =
		runtime === undefined ? undefined : createRuntimeModule(runtime, dictionary);
	const ignoreAttribute = options.ignoreAttribute ?? "data-wakame-ignore";
	const ignoredComponents = new Set(options.ignore ?? []);
	const parserPlugins = options.parserPlugins ?? [];
	const filter = createTransformFilter(options);

	return {
		name: "@wakamejs/react-rolldown",
		enforce: "pre",
		resolveId(source) {
			if (source === runtimeRequest && runtimeModule !== undefined) return runtimeId;
			return null;
		},
		load(id) {
			if (id === runtimeId && runtimeModule !== undefined) return runtimeModule;
			return null;
		},
		transform: {
			order: "pre",
			filter,
			async handler(code, id) {
				if (!interpreter(filter, code, id)) return null;
				return transformSource(
					code,
					id,
					wakame,
					runtime,
					ignoreAttribute,
					ignoredComponents,
					parserPlugins,
				);
			},
		},
	} as ReactRolldownPlugin;
}

export default wakameReactPlugin;
