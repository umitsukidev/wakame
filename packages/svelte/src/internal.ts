import { createWakame, type DictionaryInput, type Tokenizer } from "@wakamejs/core";
import MagicString from "magic-string";
import { parse, type AST, type PreprocessorGroup } from "svelte/compiler";

export interface WakamePreprocessOptions<TEntry = string> {
	tokenizer: Tokenizer<string, TEntry>;
	dictionary?: DictionaryInput<TEntry>;
}

// These elements either preserve whitespace, disallow wbr, or have semantics
// where inserting markup is inappropriate. SVG and MathML are skipped entirely.
const skipElements = new Set([
	"svg",
	"math",
	"pre",
	"code",
	"textarea",
	"title",
	"script",
	"style",
	"template",
	"noscript",
	"noembed",
	"noframes",
	"xmp",
	"plaintext",
	"listing",
	"iframe",
	"select",
	"option",
	"optgroup",
	"datalist",
	"button",
	"input",
	"head",
	"ruby",
	"rt",
	"rp",
	"nobr",
]);
const restrictedContent = new Set([
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"colgroup",
	"ul",
	"ol",
	"dl",
]);
// Only standard HTML containers provide a known context for rendered children.
const safeContainers = new Set([
	"a",
	"abbr",
	"address",
	"article",
	"aside",
	"b",
	"bdi",
	"bdo",
	"blockquote",
	"body",
	"caption",
	"cite",
	"data",
	"dd",
	"del",
	"details",
	"dfn",
	"dialog",
	"div",
	"dt",
	"em",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hgroup",
	"i",
	"ins",
	"kbd",
	"label",
	"legend",
	"li",
	"main",
	"mark",
	"menu",
	"meter",
	"nav",
	"output",
	"p",
	"progress",
	"q",
	"s",
	"samp",
	"search",
	"section",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"td",
	"th",
	"time",
	"u",
	"var",
]);
// Type declarations cannot shadow or mutate runtime bindings.
const typeOnlyNodes = new Set([
	"TSInterfaceDeclaration",
	"TSTypeAliasDeclaration",
	"TSTypeAnnotation",
	"TSTypeParameterDeclaration",
	"TSTypeParameterInstantiation",
]);
const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function isWbr(node: AST.Fragment["nodes"][number] | undefined): boolean {
	return node?.type === "RegularElement" && node.name.toLowerCase() === "wbr";
}

function shouldSkip(element: AST.RegularElement): boolean {
	if (skipElements.has(element.name.toLowerCase())) return true;
	return element.attributes.some(
		(attribute) =>
			attribute.type === "SpreadAttribute" ||
			(attribute.type === "Attribute" &&
				["contenteditable", "data-wakame-ignore"].includes(attribute.name.toLowerCase())),
	);
}

/** Create a Svelte markup preprocessor using any Wakame string tokenizer. */
export function wakamePreprocess<TEntry = string>(
	options: WakamePreprocessOptions<TEntry>,
): PreprocessorGroup {
	return createPreprocessor(options);
}

type ComponentResolver = (
	specifier: string,
	importer: string,
) => Promise<{ id: string; source: string } | undefined>;

/** @internal Used by the Vite entry to resolve components with Vite's resolver. */
export function createPreprocessor<TEntry>(
	options: WakamePreprocessOptions<TEntry>,
	resolveComponent?: ComponentResolver,
): PreprocessorGroup {
	const wakame = createWakame(options);
	return {
		name: "wakame",
		async markup({ content, filename }) {
			const ast = parse(content, {
				modern: true,
				...(filename === undefined ? {} : { filename }),
			});
			if (ast.options?.namespace && ast.options.namespace !== "html") return;
			const output = new MagicString(content);
			const imports = componentImports(ast);

			async function visitText(node: AST.Text): Promise<void> {
				// Decoded entities and normalized line endings do not have matching source offsets.
				if (node.raw !== node.data || !japanese.test(node.data)) return;
				const tokens = await wakame.tokenize(node.data);
				if (tokens.join("") !== node.data) {
					throw new Error("Wakame tokenizer output does not reconstruct the text");
				}
				let offset = 0;
				for (const token of tokens) {
					if (!token) continue;
					offset += token.length;
					if (offset === 0 || offset >= node.data.length) continue;
					const before = node.data.charCodeAt(offset - 1);
					const after = node.data.charCodeAt(offset);
					if (
						(before >= 0xd800 &&
							before <= 0xdbff &&
							after >= 0xdc00 &&
							after <= 0xdfff) ||
						/\s/u.test(node.data[offset - 1]!) ||
						/\s/u.test(node.data[offset]!)
					)
						continue;
					output.appendLeft(node.start + offset, "<wbr>");
				}
			}

			async function visitFragment(
				fragment: AST.Fragment,
				allowText = true,
				allowSnippets = true,
			): Promise<void> {
				let previous: AST.Fragment["nodes"][number] | undefined;
				for (const [index, node] of fragment.nodes.entries()) {
					switch (node.type) {
						case "Text":
							if (allowText && !isWbr(previous) && !isWbr(fragment.nodes[index + 1]))
								await visitText(node);
							break;
						case "Component": {
							const specifier = imports.get(node.name);
							if (
								!allowText ||
								!specifier ||
								!filename ||
								!resolveComponent ||
								node.attributes.some(
									(attribute) => attribute.type === "SpreadAttribute",
								)
							)
								break;
							const callee = await resolveComponent(specifier, filename);
							if (!callee) break;
							const hasAttribute = (name: string) =>
								node.attributes.some(
									(attribute) => "name" in attribute && attribute.name === name,
								);
							const supports = (name: string) =>
								supportsSnippet(
									callee.source,
									callee.id,
									node,
									resolveComponent,
									new Set([filename, callee.id]),
									name,
								);
							if (!hasAttribute("children") && (await supports("children")))
								await visitFragment(node.fragment, true, false);
							for (const snippet of node.fragment.nodes) {
								if (
									snippet.type !== "SnippetBlock" ||
									snippet.parameters.length !== 0
								)
									continue;
								const name = snippet.expression.name;
								if (!hasAttribute(name) && (await supports(name)))
									await visitFragment(snippet.body, true, false);
							}
							break;
						}
						case "RegularElement":
							if (!shouldSkip(node))
								await visitFragment(
									node.fragment,
									!restrictedContent.has(node.name.toLowerCase()),
									allowSnippets,
								);
							break;
						case "IfBlock":
							await visitFragment(node.consequent, allowText, allowSnippets);
							if (node.alternate)
								await visitFragment(node.alternate, allowText, allowSnippets);
							break;
						case "EachBlock":
							await visitFragment(node.body, allowText, allowSnippets);
							if (node.fallback)
								await visitFragment(node.fallback, allowText, allowSnippets);
							break;
						case "AwaitBlock":
							if (node.pending)
								await visitFragment(node.pending, allowText, allowSnippets);
							if (node.then) await visitFragment(node.then, allowText, allowSnippets);
							if (node.catch)
								await visitFragment(node.catch, allowText, allowSnippets);
							break;
						case "KeyBlock":
							await visitFragment(node.fragment, allowText, allowSnippets);
							break;
						case "SnippetBlock":
							if (allowSnippets)
								await visitFragment(node.body, allowText, allowSnippets);
							break;
					}
					previous = node;
				}
			}

			await visitFragment(ast.fragment);
			if (!output.hasChanged()) return;
			return {
				code: output.toString(),
				map: output.generateMap({
					hires: true,
					includeContent: true,
					source: filename?.split(/[\\/]/).at(-1) ?? "component.svelte",
				}),
			};
		},
	};
}

// The supported component shape is intentionally narrow: a $props destructure and
// direct snippet render sites whose complete HTML ancestry can be checked.
async function supportsSnippet(
	source: string,
	filename: string,
	caller: AST.Component,
	resolveComponent: ComponentResolver,
	ancestors: Set<string>,
	propName: string,
): Promise<boolean> {
	try {
		const ast = parse(source, { modern: true });
		if (ast.options?.namespace && ast.options.namespace !== "html") return false;
		type Node = { type: string; [key: string]: unknown };
		const isNode = (value: unknown): value is Node =>
			typeof value === "object" && value !== null && "type" in value;
		let propsDeclaration: Node | undefined;
		const allowedReferences = new Set<object>();
		const bindings = new Map<string, { local: string; fallback?: string }>();
		for (const statement of ast.instance?.content.body ?? []) {
			if (statement.type !== "VariableDeclaration") continue;
			for (const declaration of statement.declarations) {
				if (
					declaration.id.type !== "ObjectPattern" ||
					declaration.init?.type !== "CallExpression" ||
					declaration.init.callee.type !== "Identifier" ||
					declaration.init.callee.name !== "$props" ||
					declaration.init.arguments.length !== 0
				)
					continue;
				if (propsDeclaration || statement.declarations.length !== 1) return false;
				propsDeclaration = declaration as unknown as Node;
				for (const property of declaration.id.properties) {
					if (
						property.type === "RestElement" &&
						property.argument.type === "Identifier"
					) {
						allowedReferences.add(property.argument);
						continue;
					}
					if (
						property.type !== "Property" ||
						property.computed ||
						property.key.type !== "Identifier"
					)
						return false;
					allowedReferences.add(property.key);
					const value = property.value;
					if (value.type === "Identifier") allowedReferences.add(value);
					else if (value.type === "AssignmentPattern" && value.left.type === "Identifier")
						allowedReferences.add(value.left);
					if (value.type === "Identifier")
						bindings.set(property.key.name, { local: value.name });
					else if (
						value.type === "AssignmentPattern" &&
						value.left.type === "Identifier" &&
						value.right.type === "Literal" &&
						typeof value.right.value === "string"
					) {
						bindings.set(property.key.name, {
							local: value.left.name,
							fallback: value.right.value,
						});
					} else if (property.key.name === propName || property.key.name === "as")
						return false;
				}
			}
		}
		const snippet = bindings.get(propName);
		if (!snippet || !propsDeclaration) return false;
		const snippetName = snippet.local;
		const sensitiveNames = new Set([snippetName]);
		const dynamicBindings = new Map<string, string | undefined>();
		for (const [prop, binding] of bindings) {
			if (prop === propName) continue;
			const attribute = caller.attributes.find(
				(item) => item.type === "Attribute" && item.name === prop,
			);
			let value = binding.fallback;
			if (attribute) {
				if (
					attribute.type !== "Attribute" ||
					!Array.isArray(attribute.value) ||
					attribute.value.length !== 1 ||
					attribute.value[0]?.type !== "Text"
				)
					value = undefined;
				else value = attribute.value[0].data;
			}
			dynamicBindings.set(binding.local, value);
		}
		const imports = componentImports(ast);
		let found = 0;
		let unsafe = false;
		async function visit(fragment: AST.Fragment, safe: boolean): Promise<void> {
			for (const node of fragment.nodes) {
				switch (node.type) {
					case "RenderTag": {
						const expression =
							node.expression.type === "ChainExpression"
								? node.expression.expression
								: node.expression;
						if (
							expression.type === "CallExpression" &&
							expression.callee.type === "Identifier" &&
							expression.callee.name === snippetName &&
							expression.arguments.length === 0
						) {
							found++;
							allowedReferences.add(expression.callee);
							if (!safe) unsafe = true;
						}
						break;
					}
					case "Component": {
						let childSafe = false;
						const specifier = imports.get(node.name);
						if (
							safe &&
							specifier &&
							!node.attributes.some(
								(attribute) =>
									attribute.type === "SpreadAttribute" ||
									("name" in attribute && attribute.name === "children"),
							)
						) {
							const component = await resolveComponent(specifier, filename);
							if (component && !ancestors.has(component.id)) {
								childSafe = await supportsSnippet(
									component.source,
									component.id,
									node,
									resolveComponent,
									new Set([...ancestors, component.id]),
									"children",
								);
							}
						}
						await visit(node.fragment, childSafe);
						break;
					}
					case "RegularElement":
						await visit(
							node.fragment,
							safe &&
								safeContainers.has(node.name.toLowerCase()) &&
								!shouldSkip(node),
						);
						break;
					case "SvelteElement": {
						let name: string | undefined;
						if (node.tag.type === "Literal" && typeof node.tag.value === "string")
							name = node.tag.value;
						if (node.tag.type === "Identifier") {
							name = dynamicBindings.get(node.tag.name);
							sensitiveNames.add(node.tag.name);
							allowedReferences.add(node.tag);
						}
						const attributesSafe = !node.attributes.some(
							(attribute) =>
								attribute.type === "SpreadAttribute" ||
								(attribute.type === "Attribute" &&
									["contenteditable", "data-wakame-ignore"].includes(
										attribute.name.toLowerCase(),
									)),
						);
						await visit(
							node.fragment,
							safe &&
								!!name &&
								/^[a-z][a-z0-9-]*$/i.test(name) &&
								safeContainers.has(name.toLowerCase()) &&
								attributesSafe,
						);
						break;
					}
					case "IfBlock":
						await visit(node.consequent, safe);
						if (node.alternate) await visit(node.alternate, safe);
						break;
					case "EachBlock":
						await visit(node.body, safe);
						if (node.fallback) await visit(node.fallback, safe);
						break;
					case "AwaitBlock":
						if (node.pending) await visit(node.pending, safe);
						if (node.then) await visit(node.then, safe);
						if (node.catch) await visit(node.catch, safe);
						break;
					case "KeyBlock":
						await visit(node.fragment, safe);
						break;
					case "SnippetBlock":
						await visit(node.body, false);
						break;
				}
			}
		}
		await visit(ast.fragment, true);
		// Reject unexamined references, including mutation, indirect calls, and
		// children passed through another component or an unsupported AST node.
		function hasUnexpectedReference(value: unknown): boolean {
			if (typeof value !== "object" || value === null || allowedReferences.has(value))
				return false;
			if (Array.isArray(value)) return value.some(hasUnexpectedReference);
			if (isNode(value) && typeOnlyNodes.has(value.type)) return false;
			if (
				isNode(value) &&
				value.type === "Identifier" &&
				typeof value.name === "string" &&
				sensitiveNames.has(value.name)
			)
				return true;
			return Object.values(value).some(hasUnexpectedReference);
		}
		return found > 0 && !unsafe && !hasUnexpectedReference(ast);
	} catch {
		return false;
	}
}

// A local binding can shadow an import inside a block or snippet. Any
// identifier reference outside the import makes that name ambiguous.
function componentImports(ast: AST.Root): Map<string, string> {
	const imports = new Map<string, string>();
	for (const statement of ast.instance?.content.body ?? []) {
		if (statement.type !== "ImportDeclaration" || typeof statement.source.value !== "string")
			continue;
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportDefaultSpecifier")
				imports.set(specifier.local.name, statement.source.value);
		}
	}
	function excludeAmbiguousImports(value: unknown): void {
		if (typeof value !== "object" || value === null) return;
		if (Array.isArray(value)) {
			for (const item of value) excludeAmbiguousImports(item);
			return;
		}
		const node = value as Record<string, unknown>;
		if (
			node.type === "ImportDeclaration" ||
			(typeof node.type === "string" && typeOnlyNodes.has(node.type))
		)
			return;
		if (node.type === "Identifier" && typeof node.name === "string") imports.delete(node.name);
		for (const child of Object.values(node)) excludeAmbiguousImports(child);
	}
	excludeAmbiguousImports(ast);
	return imports;
}
