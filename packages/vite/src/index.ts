import type { Wakame } from "@wakamejs/core";
import { defaultTreeAdapter, html, parse, serialize, type DefaultTreeAdapterMap } from "parse5";
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

function applyWrapStyle(element: Element): void {
	const style = element.attrs.find((attribute) => attribute.name === "style");
	if (style) {
		const existingStyle = style.value.trim();
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
	wakame: Wakame<string>;
	applyWrapStyle?: boolean;
}

export type CreateWakamePluginOptions = WakamePluginOptions;

export type WakamePlugin = Plugin;

/** Process one HTML document with the same semantic contexts as BudouX. */
export async function transformHtml(
	html: string,
	wakame: Wakame<string>,
	shouldApplyWrapStyle = true,
): Promise<string> {
	if (html === "") return html;
	const document = parse(html);
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
	return {
		name: "wakame",
		transformIndexHtml: {
			order: "post",
			async handler(html) {
				return transformHtml(html, options.wakame, options.applyWrapStyle ?? true);
			},
		},
	};
}

export default wakamePlugin;
