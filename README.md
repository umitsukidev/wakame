# Wakame

Wakame は、日本語テキストを意味的な単位（文節など）で分割し、自然な折り返し位置（`<wbr>` 要素の挿入）を決定・適用するためのツールキットです。

Web サイトや Web アプリケーションにおいて、レスポンシブ表示やスマートフォン閲覧時に単語の途中など不自然な位置で改行されてしまう問題を解消し、美しく読みやすい日本語タイポグラフィを実現します。

## 特徴

- **高精度な形態素解析とグルーピング**: [Sudachi](https://github.com/WorksApplications/sudachi.rs)（Rust / napi-rs）による高速な形態素解析と、文節・助詞単位のグルーピングに対応。
- **JIS X 4051 準拠の禁則処理**: 行頭・行末禁則文字（括弧や句読点など）を考慮し、自然な改行位置を維持。
- **安全な HTML 変換**: AST 解析（parse5）を用いてテキストノードのみを正確に変換し、`<pre>` や `<code>` などの除外要素は自動でスキップ。
- **モダンフレームワーク対応**: Vite プラグインや Astro インテグレーションを提供し、ビルド時または開発時にシームレスに導入可能。

## パッケージ構成

本リポジトリは monorepo 構成となっており、以下のパッケージを提供しています。

| パッケージ                                | 説明                                                                       |
| :---------------------------------------- | :------------------------------------------------------------------------- |
| [`@wakamejs/core`](./packages/core)       | Wakame のコアインターフェースおよびオーケストレーション機能                |
| [`@wakamejs/sudachi`](./packages/sudachi) | Rust 実装の形態素解析エンジン Sudachi を利用したトークナイザー（辞書同梱） |
| [`@wakamejs/vite`](./packages/vite)       | HTML 内のテキストに `<wbr>` を自動挿入する Vite プラグイン                 |
| [`@wakamejs/astro`](./packages/astro)     | Astro サイト向けの Wakame インテグレーション                               |

## クイックスタート

### Vite での利用例

```bash
pnpm add -D @wakamejs/vite @wakamejs/sudachi @wakamejs/core
```

`vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import wakame from "@wakamejs/vite";
import { createSudachiTokenizer } from "@wakamejs/sudachi";

export default defineConfig(async () => {
    const tokenizer = await createSudachiTokenizer({
        grouping: "bunsetsu",
        kinsoku: true,
    });

    return {
        plugins: [
            wakame({
                tokenizer,
                applyWrapStyle: true,
            }),
        ],
    };
});
```

### Astro での利用例

```bash
pnpm add -D @wakamejs/astro @wakamejs/sudachi @wakamejs/core
```

`astro.config.mjs`:

```javascript
import { defineConfig } from "astro/config";
import wakame from "@wakamejs/astro";
import { createSudachiTokenizer } from "@wakamejs/sudachi";

export default defineConfig({
    integrations: [
        wakame({
            tokenizer: await createSudachiTokenizer({
                grouping: "bunsetsu",
                kinsoku: true,
            }),
            applyWrapStyle: true,
        }),
    ],
});
```

## 開発

本プロジェクトは pnpm ワークスペースを用いた monorepo です。

```bash
pnpm install
pnpm -r build
```

## ライセンス

[MIT](./LICENSE)
