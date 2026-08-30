import type { AstroIntegration } from "astro";
import { createWakame } from "@wakamejs/core";
import {
	transformHtml,
	type CreateWakamePluginOptions,
	type WakamePlugin,
	type WakamePluginOptions,
} from "@wakamejs/vite";
import { installDevResponseTransform } from "./dev-response-transform.js";
import { transformHtmlFiles } from "./transform-html-files.js";

export { transformHtml };
export type { CreateWakamePluginOptions, WakamePlugin, WakamePluginOptions };

/** The Astro integration created by {@link default}. */
export type WakameIntegration = AstroIntegration;

/** Create an Astro integration that transforms Astro-generated HTML with Wakame. */
export default function wakameIntegration(options: WakamePluginOptions): WakameIntegration {
	const wakame = createWakame({
		tokenizer: options.tokenizer,
		dictionary: options.dictionary ?? [],
	});
	const shouldApplyWrapStyle = options.applyWrapStyle ?? true;

	return {
		name: "@wakamejs/astro",
		hooks: {
			"astro:build:done": async ({ dir }) => {
				await transformHtmlFiles(dir, wakame, shouldApplyWrapStyle);
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
