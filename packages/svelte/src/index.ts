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
	const wakame = createWakame(options);
	return {
		name: "wakame",
		async markup({ content, filename }) {
			const ast = parse(content, { modern: true, ...(filename === undefined ? {} : { filename }) });
			if (ast.options?.namespace && ast.options.namespace !== "html") return;
			const output = new MagicString(content);

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
						(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) ||
						/\s/u.test(node.data[offset - 1]!) ||
						/\s/u.test(node.data[offset]!)
					)
						continue;
					output.appendLeft(node.start + offset, "<wbr>");
				}
			}

			async function visitFragment(fragment: AST.Fragment, allowText = true): Promise<void> {
				let previous: AST.Fragment["nodes"][number] | undefined;
				for (const [index, node] of fragment.nodes.entries()) {
					switch (node.type) {
						case "Text":
							if (allowText && !isWbr(previous) && !isWbr(fragment.nodes[index + 1]))
								await visitText(node);
							break;
						case "RegularElement":
							if (!shouldSkip(node))
								await visitFragment(node.fragment, !restrictedContent.has(node.name.toLowerCase()));
							break;
						case "IfBlock":
							await visitFragment(node.consequent, allowText);
							if (node.alternate) await visitFragment(node.alternate, allowText);
							break;
						case "EachBlock":
							await visitFragment(node.body, allowText);
							if (node.fallback) await visitFragment(node.fallback, allowText);
							break;
						case "AwaitBlock":
							if (node.pending) await visitFragment(node.pending, allowText);
							if (node.then) await visitFragment(node.then, allowText);
							if (node.catch) await visitFragment(node.catch, allowText);
							break;
						case "KeyBlock":
							await visitFragment(node.fragment, allowText);
							break;
						case "SnippetBlock":
							await visitFragment(node.body, allowText);
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
