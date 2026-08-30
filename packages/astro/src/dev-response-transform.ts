import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type { Wakame } from "@wakamejs/core";
import { transformHtml } from "@wakamejs/vite";

const htmlContentType = /^text\/html(?:\s*;|$)/i;

function headerValue(headers: OutgoingHttpHeaders | undefined, name: string): unknown {
	if (!headers) return undefined;
	const lowerName = name.toLowerCase();
	for (const [headerName, value] of Object.entries(headers)) {
		if (headerName.toLowerCase() === lowerName) return value;
	}
	return undefined;
}

function isHtmlContentType(value: unknown): boolean {
	const firstValue = Array.isArray(value) ? value[0] : value;
	return typeof firstValue === "string" && htmlContentType.test(firstValue);
}

function responseContentType(
	response: ServerResponse<IncomingMessage>,
	headers?: OutgoingHttpHeaders,
): unknown {
	return headerValue(headers, "content-type") ?? response.getHeader("content-type");
}

function removeHeader(headers: OutgoingHttpHeaders, name: string): void {
	const lowerName = name.toLowerCase();
	for (const headerName of Object.keys(headers)) {
		if (headerName.toLowerCase() === lowerName) delete headers[headerName];
	}
}

function withoutBodyLengthHeaders(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
	const result = { ...headers };
	removeHeader(result, "content-length");
	removeHeader(result, "etag");
	removeHeader(result, "transfer-encoding");
	return result;
}

function toBuffer(chunk: unknown, encoding: BufferEncoding = "utf8"): Buffer | undefined {
	if (typeof chunk === "string") return Buffer.from(chunk, encoding);
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return undefined;
}

type WriteCallback = (error?: Error | null) => void;
type EndCallback = () => void;
type BodyChunk = string | Uint8Array;

interface PendingWriteHead {
	statusCode: number;
	statusMessage: string | undefined;
	headers: OutgoingHttpHeaders | undefined;
}

type OriginalWrite = (
	chunk: BodyChunk,
	encoding?: BufferEncoding,
	callback?: WriteCallback,
) => boolean;

type OriginalEnd = (
	chunk?: BodyChunk,
	encoding?: BufferEncoding,
	callback?: EndCallback,
) => ServerResponse<IncomingMessage>;

/**
 * Buffer HTML responses from Astro's dev server so they can be transformed
 * before Node sends the response headers and body.
 */
export function installDevResponseTransform(
	request: IncomingMessage,
	response: ServerResponse<IncomingMessage>,
	wakame: Wakame<string>,
	shouldApplyWrapStyle: boolean,
): void {
	if (request.method === "HEAD") return;

	const originalWriteHead = response.writeHead.bind(response);
	const originalWrite = response.write.bind(response) as unknown as OriginalWrite;
	const originalEnd = response.end.bind(response) as unknown as OriginalEnd;
	const originalFlushHeaders = response.flushHeaders.bind(response);
	let htmlResponse = false;
	let responseFinished = false;
	let pendingWriteHead: PendingWriteHead | undefined;
	const chunks: Buffer[] = [];
	const writeCallbacks: WriteCallback[] = [];

	const finishCallbacks = (callback?: EndCallback) => {
		for (const writeCallback of writeCallbacks.splice(0)) writeCallback();
		callback?.();
	};

	const writeHead = (
		statusCode: number,
		statusMessageOrHeaders?: string | OutgoingHttpHeaders,
		headers?: OutgoingHttpHeaders,
	): ServerResponse<IncomingMessage> => {
		const statusMessage =
			typeof statusMessageOrHeaders === "string" ? statusMessageOrHeaders : undefined;
		const suppliedHeaders =
			typeof statusMessageOrHeaders === "string" ? headers : statusMessageOrHeaders;
		if (!isHtmlContentType(responseContentType(response, suppliedHeaders))) {
			return suppliedHeaders
				? statusMessage
					? originalWriteHead(statusCode, statusMessage, suppliedHeaders)
					: originalWriteHead(statusCode, suppliedHeaders)
				: statusMessage
					? originalWriteHead(statusCode, statusMessage)
					: originalWriteHead(statusCode);
		}

		htmlResponse = true;
		pendingWriteHead = { statusCode, statusMessage, headers: suppliedHeaders };
		return response;
	};

	const write = (
		chunk: BodyChunk,
		encodingOrCallback?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean => {
		if (!htmlResponse && isHtmlContentType(response.getHeader("content-type"))) {
			htmlResponse = true;
		}
		if (!htmlResponse) {
			if (typeof encodingOrCallback === "function") {
				return originalWrite(chunk, undefined, encodingOrCallback);
			}
			return originalWrite(chunk, encodingOrCallback, callback);
		}

		const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
		const writeCallback = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		const buffer = toBuffer(chunk, encoding);
		if (buffer) chunks.push(buffer);
		if (writeCallback) writeCallbacks.push(writeCallback);
		return true;
	};

	const end = (
		chunkOrCallback?: BodyChunk | EndCallback,
		encodingOrCallback?: BufferEncoding | EndCallback,
		callback?: EndCallback,
	): ServerResponse<IncomingMessage> => {
		if (!htmlResponse && isHtmlContentType(response.getHeader("content-type"))) {
			htmlResponse = true;
		}
		if (!htmlResponse) {
			if (typeof chunkOrCallback === "function") {
				return originalEnd(undefined, undefined, chunkOrCallback);
			}
			if (typeof encodingOrCallback === "function") {
				return originalEnd(chunkOrCallback, undefined, encodingOrCallback);
			}
			return originalEnd(chunkOrCallback, encodingOrCallback, callback);
		}

		if (responseFinished) return response;
		responseFinished = true;
		const chunk = typeof chunkOrCallback === "function" ? undefined : chunkOrCallback;
		const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
		const endCallback =
			typeof chunkOrCallback === "function"
				? chunkOrCallback
				: typeof encodingOrCallback === "function"
					? encodingOrCallback
					: callback;
		const buffer = toBuffer(chunk, encoding);
		if (buffer) chunks.push(buffer);

		void (async () => {
			const source = Buffer.concat(chunks).toString("utf8");
			// Dev responses can be transformed again after an Astro reload.
			const transformed = await transformHtml(source, wakame, shouldApplyWrapStyle, {
				preserveExistingWbr: false,
			});
			const body = Buffer.from(transformed, "utf8");

			response.removeHeader("content-length");
			response.removeHeader("etag");
			response.removeHeader("transfer-encoding");
			response.setHeader("content-length", body.byteLength);
			if (pendingWriteHead) {
				const { statusCode, statusMessage, headers } = pendingWriteHead;
				const adjustedHeaders = headers ? withoutBodyLengthHeaders(headers) : undefined;
				if (adjustedHeaders) adjustedHeaders["content-length"] = body.byteLength;
				if (statusMessage !== undefined) {
					if (adjustedHeaders) originalWriteHead(statusCode, statusMessage, adjustedHeaders);
					else originalWriteHead(statusCode, statusMessage);
				} else if (adjustedHeaders) {
					originalWriteHead(statusCode, adjustedHeaders);
				} else {
					originalWriteHead(statusCode);
				}
			}
			originalEnd(body, "utf8", () => finishCallbacks(endCallback));
		})().catch((error: unknown) => {
			response.destroy(error instanceof Error ? error : new Error(String(error)));
		});
		return response;
	};

	response.writeHead = writeHead as typeof response.writeHead;
	response.write = write as typeof response.write;
	response.end = end as typeof response.end;
	response.flushHeaders = (() => {
		if (!htmlResponse && isHtmlContentType(response.getHeader("content-type"))) {
			htmlResponse = true;
		}
		if (!htmlResponse) originalFlushHeaders();
	}) as typeof response.flushHeaders;
}
