# @wakamejs/svelte

Svelte 5 のテンプレートに含まれる静的な日本語テキストに、文節などの意味的な境界で `<wbr>` を挿入するプリプロセッサーです。コンパイル前に変換し、元の `.svelte` ファイルを参照できるようにソースマップを返します。

## インストール

Node.js 20 以上と Svelte 5 が必要です。既存の Svelte プロジェクトにプリプロセッサーと BudouX トークナイザーを追加します。

```bash
pnpm add -D @wakamejs/svelte @wakamejs/budoux
```

## 使い方

### `vite.config.ts` での設定

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createBudouxTokenizer } from "@wakamejs/budoux";
import { wakamePreprocess } from "@wakamejs/svelte";

const tokenizer = createBudouxTokenizer({ language: "ja" });

export default defineConfig({
    plugins: [svelte({ preprocess: [wakamePreprocess({ tokenizer })] })],
});
```

SvelteKit 2.62 以降では `sveltekit({ preprocess: [wakamePreprocess({ tokenizer })] })` に渡します。既存の SvelteKit 2 プロジェクトで Vite 側に設定を移す場合は、`svelte.config.js` の設定も一緒に移します。SvelteKit 2.62 より前では `svelte.config.js` の `preprocess` に登録します。

他のプリプロセッサーで TypeScript や CSS を変換している場合は、配列の後ろに `wakamePreprocess({ tokenizer })` を追加します。

### `wakamePreprocess({ tokenizer, dictionary? })`

Svelte の `PreprocessorGroup` を返します。`tokenizer` には Wakame の文字列トークナイザーを渡します。`dictionary` は対応するトークナイザーにカスタム辞書を渡すためのオプションです。

## 変換範囲

静的な日本語テキストをテキストノード単位で分割します。`{#if}` や `{#each}` などのブロック内の静的テキストも対象です。式、属性、`{@html}`、SVG・MathML、`pre` や `contenteditable` などの領域は対象外です。`data-wakame-ignore` を要素に付けると、その配下を除外できます。

HTML エンティティのデコードで元のソース位置がずれるテキストや、既存の `<wbr>` に隣接するテキストはそのまま残します。折り返しに使う CSS はアプリケーション側で設定できます。

## ライセンス

MIT
