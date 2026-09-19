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
import { createWakame, type DictionaryInput, type Tokenizer } from "@wakamejs/core";
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
	parserPlugins?: readonly ParserPlugin[];
}

export type ReactRolldownPlugin = Plugin & { enforce: "pre" };

interface Candidate {
	path: NodePath<t.JSXText | t.JSXExpressionContainer>;
	semanticText: string;
}

const defaultSourcePattern = /\.[jt]sx(?:$|\?)/;
const nodeModulesPattern = /(?:^|\/)node_modules(?:\/|$)/;

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
	for (let index = 0; index < normalized.length; index++) {
		const character = normalized[index];
		if (character === undefined) continue;
		if (character === "*" && normalized[index + 1] === "*") {
			if (normalized[index + 2] === "/") {
				source += "(?:.*/)?";
				index += 2;
			} else {
				source += ".*";
				index++;
			}
			continue;
		}
		if (character === "*") {
			source += "[^/]*";
			continue;
		}
		if (character === "?") {
			source += "[^/]";
			continue;
		}
		if ("\\^$+?.()|{}[]".includes(character)) source += `\\${character}`;
		else source += character;
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

function elementName(element: t.JSXOpeningElement): string | undefined {
	const name = element.name;
	return t.isJSXIdentifier(name) ? name.name : undefined;
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

function isSafeIntrinsic(element: t.JSXElement, ignoreAttribute: string): boolean {
	const name = elementName(element.openingElement);
	if (name === undefined || name !== name.toLowerCase()) return false;
	if (skipElements.has(name) || restrictedElements.has(name)) return false;
	return !hasOptOutAttribute(element.openingElement, ignoreAttribute);
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

function collectCandidates(ast: t.File, ignoreAttribute: string): Candidate[] {
	const candidates: Candidate[] = [];
	traverse(ast, {
		CallExpression(path) {
			if (isPortalCallee(path.node.callee)) path.skip();
		},
		JSXElement(path) {
			if (!isSafeIntrinsic(path.node, ignoreAttribute)) {
				path.skip();
				return;
			}

			for (const childPath of path.get("children")) {
				if (!childPath.isJSXText() && !childPath.isJSXExpressionContainer()) continue;
				const candidateNode = childPath.isJSXText()
					? childPath.node
					: t.isStringLiteral(childPath.node.expression)
						? childPath.node
						: undefined;
				if (candidateNode === undefined) continue;
				const semanticText = buildSemanticText(candidateNode);
				if (semanticText) candidates.push({ path: childPath, semanticText });
			}
		},
	});
	return candidates;
}

function createWbrElement(): t.JSXElement {
	const name = t.jsxIdentifier("wbr");
	return t.jsxElement(t.jsxOpeningElement(name, [], true), null, [], true);
}

function createReplacement(tokens: readonly string[]): (t.JSXExpressionContainer | t.JSXElement)[] {
	const replacement: (t.JSXExpressionContainer | t.JSXElement)[] = [];
	for (const [index, token] of tokens.entries()) {
		if (index > 0) replacement.push(createWbrElement());
		replacement.push(t.jsxExpressionContainer(t.stringLiteral(token)));
	}
	return replacement;
}

async function transformSource(
	code: string,
	id: string,
	wakame: ReturnType<typeof createWakame<string, string>>,
	ignoreAttribute: string,
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
	const candidates = collectCandidates(ast, ignoreAttribute);
	if (candidates.length === 0) return null;

	const transformed: Array<{ candidate: Candidate; tokens: readonly string[] }> = [];
	for (const candidate of candidates) {
		const tokens = await wakame.tokenize(candidate.semanticText);
		const restored = tokens.join("");
		if (restored !== candidate.semanticText) {
			throw new Error(
				`Wakame tokenizer output does not reconstruct JSX text (expected ${JSON.stringify(candidate.semanticText)}, received ${JSON.stringify(restored)})`,
			);
		}
		const nonEmptyTokens = tokens.filter((token: string) => token.length > 0);
		if (nonEmptyTokens.length > 1) transformed.push({ candidate, tokens: nonEmptyTokens });
	}
	if (transformed.length === 0) return null;

	transformed.sort(
		(left, right) => (right.candidate.path.node.start ?? 0) - (left.candidate.path.node.start ?? 0),
	);
	for (const { candidate, tokens } of transformed) {
		candidate.path.replaceWithMultiple(createReplacement(tokens));
	}

	const generated = generate(ast, { sourceMaps: true, sourceFileName: id }, code);
	return { code: generated.code, map: generated.map };
}

/** Create an SSR-safe React transform plugin for Rolldown. */
export function wakameReactPlugin(options: ReactRolldownPluginOptions): ReactRolldownPlugin {
	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary: options.dictionary ?? [],
	});
	const ignoreAttribute = options.ignoreAttribute ?? "data-wakame-ignore";
	const parserPlugins = options.parserPlugins ?? [];
	const filter = createTransformFilter(options);

	return {
		name: "@wakamejs/react-rolldown",
		enforce: "pre",
		transform: {
			order: "pre",
			filter,
			async handler(code, id) {
				if (!interpreter(filter, code, id)) return null;
				return transformSource(code, id, wakame, ignoreAttribute, parserPlugins);
			},
		},
	} as ReactRolldownPlugin;
}

export default wakameReactPlugin;
