import type { AstroIntegration } from "astro";
import { createWakame } from "@wakamejs/core";
import {
	transformHtml,
	type CreateWakamePluginOptions,
	type TransformHtmlOptions,
	type WakamePlugin,
	type WakamePluginOptions,
} from "@wakamejs/vite";
import { installDevResponseTransform } from "./dev-response-transform.js";
import { transformHtmlFiles } from "./transform-html-files.js";

export { transformHtml };
export type { CreateWakamePluginOptions, TransformHtmlOptions, WakamePlugin, WakamePluginOptions };

/** The Astro integration created by {@link default}. */
export type WakameIntegration = AstroIntegration;

/** Options for the Astro integration. */
export interface WakameIntegrationOptions extends WakamePluginOptions {
	/** Maximum number of HTML files transformed at once during Astro builds. Defaults to 4. */
	buildConcurrency?: number;
}

/** Create an Astro integration that transforms Astro-generated HTML with Wakame. */
export default function wakameIntegration(options: WakameIntegrationOptions): WakameIntegration {
	const buildConcurrency = options.buildConcurrency ?? 4;
	if (!Number.isSafeInteger(buildConcurrency) || buildConcurrency <= 0) {
		throw new RangeError("buildConcurrency must be a positive safe integer");
	}

	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary: options.dictionary ?? [],
	});
	const shouldApplyWrapStyle = options.applyWrapStyle ?? true;

	return {
		name: "@wakamejs/astro",
		hooks: {
			"astro:build:done": async ({ dir, logger }) => {
				await transformHtmlFiles(dir, wakame, shouldApplyWrapStyle, buildConcurrency);
				logger.info("HTML transformation completed.");
			},
			"astro:server:setup": ({ server }) => {
				server.middlewares.use((request, response, next) => {
					installDevResponseTransform(request, response, wakame, shouldApplyWrapStyle);
					next();
				});
			},
		},
	};
}
