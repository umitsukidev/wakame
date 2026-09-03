# @wakamejs/vite

Wakame を利用して HTML 内の日本語テキストに意味的な `<wbr>` 要素を自動挿入する Vite プラグインです。

画面幅に応じた自然な日本語の折り返しを実現し、スマートフォンやレスポンシブデザインにおける可読性を向上させます。

## 特徴

- **構文木解析による安全な HTML 変換**: [parse5](https://github.com/inikulin/parse5) を用いて HTML を解析し、テキストノードに対してのみ正確に `<wbr>` を挿入します。
- **除外要素の自動スキップ**: `code`, `pre`, `script`, `style`, `textarea` など、改行を挿入すべきでない要素は自動的にスキップされます。
- **CSS スタイルの自動適用**: 対象ブロック要素に `word-break: keep-all; overflow-wrap: break-word;` をインラインスタイルとして付与（オプションで無効化可能）。
- **HTML 変換関数のエクスポート**: Vite プラグインとしてだけでなく、スタンドアロンの `transformHtml` 関数としても使用可能。

## インストール

```bash
pnpm add -D @wakamejs/vite @wakamejs/sudachi @wakamejs/core
# または
npm install -D @wakamejs/vite @wakamejs/sudachi @wakamejs/core
# または
yarn add -D @wakamejs/vite @wakamejs/sudachi @wakamejs/core
```

## 使い方

### `vite.config.ts` での設定

[`@wakamejs/sudachi`](../sudachi) と組み合わせて使用する設定例です：

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

### プログラマティックな利用 (`transformHtml`)

Vite プラグインを介さずに、HTML 文字列を直接変換することも可能です。

```typescript
import { createWakame } from "@wakamejs/core";
import { createSudachiTokenizer } from "@wakamejs/sudachi";
import { transformHtml } from "@wakamejs/vite";

const tokenizer = await createSudachiTokenizer({
    grouping: "bunsetsu",
    kinsoku: true,
});
const wakame = createWakame({ tokenizer });

const inputHtml = "<h1>美味しいお茶を飲みました。</h1>";
const outputHtml = await transformHtml(inputHtml, wakame, true);
console.log(outputHtml);
// => <h1 style="word-break: keep-all; overflow-wrap: break-word;">美味しい<wbr>お茶を<wbr>飲みました。</h1>
```

## API リファレンス

### `wakamePlugin(options)` (デフォルトエクスポート)

Vite の `transformIndexHtml`（order: "post"）フックで動作する Vite プラグインを作成します。

#### オプション (`WakamePluginOptions`)

| オプション       | 型                  | デフォルト値 | 説明                                                                                                            |
| :--------------- | :------------------ | :----------- | :-------------------------------------------------------------------------------------------------------------- |
| `tokenizer`      | `Tokenizer<string>` | **必須**     | テキスト分割を行うトークナイザー実装                                                                            |
| `dictionary`     | `DictionaryInput`   | `undefined`  | トークナイザーに渡すカスタム辞書                                                                                |
| `applyWrapStyle` | `boolean`           | `true`       | `true` の場合、変換対象要素に `word-break: keep-all; overflow-wrap: break-word;` をインラインスタイルとして付与 |

### `transformHtml(html, wakame, shouldApplyWrapStyle?, options?)`

指定された HTML 文字列内のテキストをトークナイズし、`<wbr>` タグを挿入した HTML 文字列を返します。

#### 引数

- `html`: 変換対象の HTML 文字列
- `wakame`: `createWakame` から返される Wakame インスタンス
- `shouldApplyWrapStyle`: スタイルを付与するかどうか（デフォルト: `true`）
- `options`: `TransformHtmlOptions`
    - `preserveExistingWbr`: 既存の `<wbr>` を保持するかどうか。`false` を指定すると既存の `<wbr>` を除去してから再計算します。

## 対応環境

- **Node.js**: >= 20
- **Vite**: ^7.0.0 || ^8.0.0

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/sudachi`](../sudachi): Sudachi トークナイザー
- [`@wakamejs/astro`](../astro): Astro 向けインテグレーション

## ライセンス

MIT
