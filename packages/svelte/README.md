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
import { wakameSvelteVite } from "@wakamejs/svelte/vite";

const tokenizer = createBudouxTokenizer({ language: "ja" });

export default defineConfig({
    plugins: [wakameSvelteVite({ tokenizer }), svelte()],
});
```

`wakameSvelteVite` は `svelte()` より前に配置してください。@sveltejs/vite-plugin-svelte 7 のプリプロセッサーの後、Svelte コンパイルの前に変換します。Vite のエイリアス設定もコンポーネントの解決に利用します。

### `wakamePreprocess({ tokenizer, dictionary? })`

Vite を使わない場合は `@wakamejs/svelte` の `wakamePreprocess` を利用できます。Svelte の `PreprocessorGroup` を返します。`tokenizer` には Wakame の文字列トークナイザーを渡します。`dictionary` は対応するトークナイザーにカスタム辞書を渡すためのオプションです。

## 変換範囲

静的な日本語テキストをテキストノード単位で分割します。`{#if}` や `{#each}` などのブロック内の静的テキストも対象です。式、属性、`{@html}`、SVG・MathML、`pre` や `contenteditable` などの領域は対象外です。`data-wakame-ignore` を要素に付けると、その配下を除外できます。

Vite では、静的に import した Svelte コンポーネントの子要素も、`$props()` の `children` を安全な HTML 要素の中で直接 `{@render children()}` していると確認できる場合に対象です。`<svelte:element>` はタグが文字列の属性または `$props()` の文字列の既定値で確定する場合に限ります。描画位置やタグを確定できない場合は変換しません。

HTML エンティティのデコードで元のソース位置がずれるテキストや、既存の `<wbr>` に隣接するテキストはそのまま残します。折り返しに使う CSS はアプリケーション側で設定できます。

## ライセンス

MIT
