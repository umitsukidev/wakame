import { createWakame, type DictionaryInput, type Tokenizer, type Wakame } from "@wakamejs/core";
import {
	defaultTreeAdapter,
	html,
	parse,
	parseFragment,
	serialize,
	serializeOuter,
	type DefaultTreeAdapterMap,
} from "parse5";
import { SAXParser, type StartTag } from "parse5-sax-parser";
import type { Plugin } from "vite";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type TextNode = DefaultTreeAdapterMap["textNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];

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
]);

const blockElements = new Set([
	"html",
	"body",
	"address",
	"blockquote",
	"center",
	"dialog",
	"div",
	"figure",
	"figcaption",
	"footer",
	"form",
	"header",
	"legend",
	"main",
	"listing",
	"p",
	"article",
	"aside",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hgroup",
	"nav",
	"section",
	"dir",
	"dd",
	"dl",
	"dt",
	"menu",
	"ol",
	"ul",
	"li",
	"table",
	"caption",
	"col",
	"tr",
	"td",
	"th",
	"fieldset",
	"details",
	"summary",
	"marquee",
]);

const enum ElementAction {
	Inline,
	Block,
	Skip,
	Break,
	NoBreak,
	BreakOpportunity,
}

function actionForElement(element: Element): ElementAction {
	const name = element.tagName;
	if (skipElements.has(name)) return ElementAction.Skip;
	if (name === "br" || name === "hr") return ElementAction.Break;
	if (name === "wbr") return ElementAction.BreakOpportunity;
	if (name === "nobr") return ElementAction.NoBreak;
	return blockElements.has(name) ? ElementAction.Block : ElementAction.Inline;
}

interface ParagraphNode {
	node: TextNode;
	parent: ParentNode;
	text: string;
	canSplit: boolean;
}

interface Paragraph {
	element: Element;
	nodes: ParagraphNode[];
	forcedOpportunities: Set<number>;
}

interface FlowContext {
	paragraph: Paragraph;
}

function newParagraph(element: Element): Paragraph {
	return { element, nodes: [], forcedOpportunities: new Set() };
}

function isHtmlElement(element: Element): boolean {
	return defaultTreeAdapter.getNamespaceURI(element) === html.NS.HTML;
}

function textOf(node: TextNode): string {
	return node.value;
}

function addText(context: FlowContext, node: TextNode, canSplit: boolean): void {
	const parent = node.parentNode;
	if (!parent) return;
	const text = textOf(node);
	const offset = context.paragraph.nodes.reduce((sum, item) => sum + item.text.length, 0);
	if (canSplit) {
		for (let index = 0; index < text.length; index++) {
			if (text.charCodeAt(index) === 0x200b) {
				context.paragraph.forcedOpportunities.add(offset + index + 1);
			}
		}
	}
	context.paragraph.nodes.push({ node, parent, text, canSplit });
}

function flush(context: FlowContext, paragraphs: Paragraph[]): void {
	if (context.paragraph.nodes.length > 0) paragraphs.push(context.paragraph);
}

function visitElement(
	element: Element,
	parent: FlowContext | undefined,
	paragraphs: Paragraph[],
): void {
	if (!isHtmlElement(element)) return;
	const action = actionForElement(element);
	if (action === ElementAction.Skip) return;
	if (action === ElementAction.Break) {
		if (parent) {
			flush(parent, paragraphs);
			parent.paragraph = newParagraph(parent.paragraph.element);
		}
		return;
	}
	if (action === ElementAction.BreakOpportunity) {
		if (parent) {
			let offset = 0;
			for (const node of parent.paragraph.nodes) offset += node.text.length;
			parent.paragraph.forcedOpportunities.add(offset);
		}
		return;
	}

	const isNewParagraph = parent === undefined || action === ElementAction.Block;
	const context = isNewParagraph ? { paragraph: newParagraph(element) } : parent;

	for (const child of element.childNodes) {
		if (child.nodeName === "#text") {
			addText(context, child as TextNode, action !== ElementAction.NoBreak);
			continue;
		}
		if (child.nodeName === "#comment" || child.nodeName === "#documentType") continue;
		visitElement(child as Element, context, paragraphs);
	}

	if (isNewParagraph) flush(context, paragraphs);
}

function createWbr(): Element {
	return defaultTreeAdapter.createElement("wbr", html.NS.HTML, []);
}

const wrapStyle = "word-break: keep-all; overflow-wrap: anywhere;";

function removeExistingWbrs(parent: ParentNode): void {
	const wbrs: ChildNode[] = [];
	for (const child of defaultTreeAdapter.getChildNodes(parent)) {
		if (child.nodeName === "wbr") {
			if (isHtmlElement(child as Element)) wbrs.push(child);
			continue;
		}
		if (
			child.nodeName === "#text" ||
			child.nodeName === "#comment" ||
			child.nodeName === "#documentType"
		) {
			continue;
		}
		if (!isHtmlElement(child as Element)) continue;
		removeExistingWbrs(child as ParentNode);
	}
	for (const wbr of wbrs) defaultTreeAdapter.detachNode(wbr);
}

function applyWrapStyle(element: Element): void {
	const style = element.attrs.find((attribute) => attribute.name === "style");
	if (style) {
		const existingStyle = style.value.trim();
		if (existingStyle.includes(wrapStyle)) return;
		const separator = existingStyle.endsWith(";") ? " " : "; ";
		style.value = existingStyle ? `${existingStyle}${separator}${wrapStyle}` : wrapStyle;
		return;
	}
	element.attrs.push({ name: "style", value: wrapStyle });
}

function insertChildren(parent: ParentNode, index: number, nodes: ChildNode[]): void {
	const children = defaultTreeAdapter.getChildNodes(parent);
	let insertionIndex = index;
	for (const node of nodes) {
		// appendChild is the tree-adapter operation that establishes parentNode.
		// Move the appended node to the requested position afterwards.
		defaultTreeAdapter.appendChild(parent, node);
		children.splice(children.length - 1, 1);
		children.splice(insertionIndex, 0, node);
		insertionIndex++;
	}
}

function replaceTextNode(
	node: ParagraphNode,
	splitOffsets: readonly number[],
	appendWbr: boolean,
): void {
	const index = node.parent.childNodes.indexOf(node.node);
	if (index < 0) return;
	const replacement: ChildNode[] = [];
	let chunkStart = 0;
	for (const offset of splitOffsets) {
		const chunk = node.text.slice(chunkStart, offset);
		if (chunk) replacement.push(defaultTreeAdapter.createTextNode(chunk));
		replacement.push(createWbr());
		chunkStart = offset;
	}
	const rest = node.text.slice(chunkStart);
	if (rest) replacement.push(defaultTreeAdapter.createTextNode(rest));
	if (appendWbr) replacement.push(createWbr());
	defaultTreeAdapter.detachNode(node.node);
	insertChildren(node.parent, index, replacement);
}

function paragraphText(paragraph: Paragraph): string {
	return paragraph.nodes.map((node) => node.text).join("");
}

function tokenBoundaries(text: string, tokens: readonly string[]): number[] {
	const boundaries: number[] = [];
	let offset = 0;
	for (const token of tokens) {
		if (token.length === 0) continue;
		offset += token.length;
		if (offset < text.length) boundaries.push(offset);
	}
	return boundaries;
}

function addBoundaries(paragraph: Paragraph, boundaries: readonly number[]): void {
	const effectiveBoundaries = boundaries.filter(
		(boundary) => !paragraph.forcedOpportunities.has(boundary),
	);
	if (effectiveBoundaries.length === 0) return;
	const boundariesWithSentinel = [...effectiveBoundaries, Number.POSITIVE_INFINITY];

	const splitOffsets = new Map<TextNode, number[]>();
	const appendWbr = new Set<TextNode>();
	let boundaryIndex = 0;
	let boundary = boundariesWithSentinel[0]!;
	let offset = 0;
	let lastSplittable: ParagraphNode | undefined;

	for (const node of paragraph.nodes) {
		const nodeLength = node.text.length;
		if (nodeLength === 0) continue;
		const nodeEnd = offset + nodeLength;
		if (!node.canSplit) {
			// A boundary before a NoBreak node is placed after the preceding
			// splittable node, matching BudouX's splitNodes behavior.
			if (lastSplittable && boundary === offset) appendWbr.add(lastSplittable.node);
			while (boundary < nodeEnd) {
				boundary = boundariesWithSentinel[++boundaryIndex]!;
			}
			lastSplittable = undefined;
			offset = nodeEnd;
			continue;
		}

		lastSplittable = node;
		if (boundary >= nodeEnd) {
			offset = nodeEnd;
			continue;
		}
		const offsets = splitOffsets.get(node.node) ?? [];
		while (boundary < nodeEnd) {
			offsets.push(boundary - offset);
			boundary = boundariesWithSentinel[++boundaryIndex]!;
		}
		splitOffsets.set(node.node, offsets);
		offset = nodeEnd;
	}

	for (const node of paragraph.nodes) {
		const offsets = splitOffsets.get(node.node);
		const shouldAppendWbr = appendWbr.has(node.node);
		if (offsets || shouldAppendWbr) replaceTextNode(node, offsets ?? [], shouldAppendWbr);
	}
}

async function processParagraph(
	paragraph: Paragraph,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
	styledElements: Set<Element>,
): Promise<void> {
	if (!paragraph.nodes.some((node) => node.canSplit)) return;
	const text = paragraphText(paragraph);
	if (/^\s*$/.test(text)) return;
	const tokens = await wakame.tokenize(text);
	const restored = tokens.join("");
	if (restored !== text) {
		throw new Error(
			`Wakame tokenizer output does not reconstruct the paragraph text (expected ${JSON.stringify(text)}, received ${JSON.stringify(restored)})`,
		);
	}
	const boundaries = tokenBoundaries(text, tokens);
	if (boundaries.length === 0) return;
	addBoundaries(paragraph, boundaries);
	if (shouldApplyWrapStyle && !styledElements.has(paragraph.element)) {
		applyWrapStyle(paragraph.element);
		styledElements.add(paragraph.element);
	}
}

export interface WakamePluginOptions {
	tokenizer: Tokenizer<string>;
	dictionary?: DictionaryInput;
	applyWrapStyle?: boolean;
}

export type CreateWakamePluginOptions = WakamePluginOptions;

export type WakamePlugin = Plugin;

export interface TransformHtmlOptions {
	/**
	 * Keep `<wbr>` elements already present in the input HTML. Set this to false
	 * when the caller owns the generated HTML and wants to recompute all breaks.
	 */
	preserveExistingWbr?: boolean;
	/**
	 * Parse and serialize only the contents of an explicit `<body>` element.
	 * Documents without an unambiguous explicit body use the full-document path.
	 */
	bodyOnly?: boolean;
}

interface BodyRange {
	startTagStart: number;
	startTagEnd: number;
	endTagStart: number;
	endTagEnd: number;
	attrs: Element["attrs"];
}

const headElements = new Set([
	"base",
	"basefont",
	"bgsound",
	"link",
	"meta",
	"title",
	"noscript",
	"noframes",
	"style",
	"script",
	"template",
]);

const boundaryContextElements = new Set(["template", "svg", "math", "noscript", "noframes"]);
const foreignElements = new Set(["svg", "math"]);
const rawTextElements = new Set([
	"script",
	"style",
	"title",
	"noscript",
	"noframes",
	"textarea",
	"xmp",
	"iframe",
	"noembed",
	"plaintext",
]);

function toTreeAttributes(startTag: StartTag): Element["attrs"] {
	return startTag.attrs.map((attribute) => ({ ...attribute }));
}

/**
 * Find a safe explicit body range without constructing a document tree. The
 * SAX tokenizer handles comments and raw-text elements, while conservative
 * structural checks reject cases where HTML parsing would create the body
 * before the explicit body tag.
 */
function findBodyRange(source: string): BodyRange | undefined {
	const parser = new SAXParser({ sourceCodeLocationInfo: true });
	const boundaryContexts: string[] = [];
	let rawTextElement: string | undefined;
	let headClosed = false;
	let bodyStarted = false;
	let bodyEnded = false;
	let range: BodyRange | undefined;
	let unsafe = false;

	parser.on("startTag", (token) => {
		const insideIgnoredContext = boundaryContexts.length > 0;
		if (!insideIgnoredContext && !bodyStarted) {
			if (token.tagName === "body") {
				const location = token.sourceCodeLocation;
				if (!location || token.selfClosing) {
					unsafe = true;
					return;
				}
				bodyStarted = true;
				range = {
					startTagStart: location.startOffset,
					startTagEnd: location.endOffset,
					endTagStart: -1,
					endTagEnd: -1,
					attrs: toTreeAttributes(token),
				};
			} else if (
				token.tagName === "html" ||
				token.tagName === "head" ||
				(!headClosed && headElements.has(token.tagName))
			) {
				// These start tags do not implicitly create a body while the parser
				// is in its initial or head insertion modes.
			} else {
				unsafe = true;
			}
		} else if (!insideIgnoredContext && bodyEnded) {
			unsafe = true;
		} else if (!insideIgnoredContext && token.tagName === "body") {
			unsafe = true;
		}

		if (boundaryContextElements.has(token.tagName)) {
			const isForeign = boundaryContexts.some((name) => foreignElements.has(name));
			const selfClosingForeignTag = isForeign && token.selfClosing;
			if (!selfClosingForeignTag && token.tagName !== "svg" && token.tagName !== "math") {
				boundaryContexts.push(token.tagName);
			} else if (!token.selfClosing) {
				boundaryContexts.push(token.tagName);
			}
		}

		if (!rawTextElement && rawTextElements.has(token.tagName)) {
			rawTextElement = token.tagName;
		}
	});

	parser.on("text", ({ text }) => {
		if (bodyEnded) {
			if (/\S/.test(text)) unsafe = true;
			return;
		}
		if (
			!bodyStarted &&
			!rawTextElement &&
			!boundaryContexts.includes("template") &&
			/\S/.test(text)
		) {
			unsafe = true;
		}
	});

	parser.on("endTag", (token) => {
		if (bodyEnded) {
			if (token.tagName !== "html") unsafe = true;
			return;
		}
		if (rawTextElement === token.tagName) rawTextElement = undefined;

		if (boundaryContextElements.has(token.tagName)) {
			const contextIndex = boundaryContexts.lastIndexOf(token.tagName);
			if (contextIndex < 0 || contextIndex !== boundaryContexts.length - 1) {
				unsafe = true;
			} else {
				boundaryContexts.pop();
			}
		}

		if (boundaryContexts.length > 0) return;
		if (token.tagName === "head" && !bodyStarted) {
			headClosed = true;
			return;
		}
		if (token.tagName !== "body") return;

		const location = token.sourceCodeLocation;
		if (!range || range.endTagStart >= 0 || !location) {
			unsafe = true;
			return;
		}
		range.endTagStart = location.startOffset;
		range.endTagEnd = location.endOffset;
		bodyEnded = true;
	});

	parser.on("doctype", () => {
		if (bodyEnded) unsafe = true;
	});

	parser.end(source);
	if (
		unsafe ||
		!range ||
		range.endTagStart < range.startTagEnd ||
		range.endTagEnd < range.endTagStart ||
		range.endTagEnd > source.length
	) {
		return undefined;
	}
	return range;
}

async function transformBodyFragment(
	source: string,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
	options: TransformHtmlOptions,
): Promise<string | undefined> {
	const range = findBodyRange(source);
	if (!range) return undefined;

	const body = defaultTreeAdapter.createElement(
		"body",
		html.NS.HTML,
		range.attrs.map((attribute) => ({ ...attribute })),
	);
	const fragment = parseFragment(body, source.slice(range.startTagEnd, range.endTagStart), {});
	for (const child of fragment.childNodes) defaultTreeAdapter.appendChild(body, child);

	if (options.preserveExistingWbr === false) removeExistingWbrs(body);
	const paragraphs: Paragraph[] = [];
	const styledElements = new Set<Element>();
	visitElement(body, undefined, paragraphs);
	for (const paragraph of paragraphs) {
		await processParagraph(paragraph, wakame, shouldApplyWrapStyle, styledElements);
	}

	const bodyStartTag =
		JSON.stringify(body.attrs) === JSON.stringify(range.attrs)
			? source.slice(range.startTagStart, range.startTagEnd)
			: (() => {
					const bodyStartTagNode = defaultTreeAdapter.createElement(
						"body",
						html.NS.HTML,
						body.attrs.map((attribute) => ({ ...attribute })),
					);
					const serialized = serializeOuter(bodyStartTagNode);
					const closingTagStart = serialized.lastIndexOf("</body>");
					return serialized.slice(0, closingTagStart);
				})();
	const bodyContents = serialize(body);
	return (
		source.slice(0, range.startTagStart) +
		bodyStartTag +
		bodyContents +
		source.slice(range.endTagStart)
	);
}

/** Process one HTML document with the same semantic contexts as BudouX. */
export async function transformHtml(
	html: string,
	wakame: Wakame<string>,
	shouldApplyWrapStyle = true,
	options: TransformHtmlOptions = {},
): Promise<string> {
	if (html === "") return html;
	if (options.bodyOnly) {
		const transformed = await transformBodyFragment(html, wakame, shouldApplyWrapStyle, options);
		if (transformed !== undefined) return transformed;
	}
	const document = parse(html);
	if (options.preserveExistingWbr === false) removeExistingWbrs(document);
	const paragraphs: Paragraph[] = [];
	const styledElements = new Set<Element>();
	for (const child of document.childNodes) {
		if (child.nodeName === "html") {
			visitElement(child as Element, undefined, paragraphs);
		}
	}
	for (const paragraph of paragraphs) {
		await processParagraph(paragraph, wakame, shouldApplyWrapStyle, styledElements);
	}
	return serialize(document);
}

/** Create a Vite post transformIndexHtml plugin for Wakame. */
function wakamePlugin(options: WakamePluginOptions): WakamePlugin {
	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary: options.dictionary ?? [],
	});

	return {
		name: "wakame",
		transformIndexHtml: {
			order: "post",
			async handler(html) {
				return transformHtml(html, wakame, options.applyWrapStyle ?? true);
			},
		},
	};
}

export default wakamePlugin;
