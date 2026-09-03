# @wakamejs/astro

Wakame を利用して Astro サイトの HTML に意味的な `<wbr>` 要素を自動挿入する Astro インテグレーションです。

静的ビルド時の HTML ファイル変換および開発サーバー（dev server）でのリアルタイム変換の両方に対応し、日本語テキストの美しい折り返しを実現します。

## 特徴

- **静的ビルド対応**: `astro build` 時に出力ディレクトリ内の HTML ファイルを走査し、自動的に `<wbr>` を挿入します。
- **開発サーバー対応**: `astro dev` 起動中もミドルウェア経由で HTML レスポンスをリアルタイムに変換するため、開発中も表示確認が可能です。
- **CSS スタイルの自動適用**: 対象要素に `word-break: keep-all; overflow-wrap: break-word;` をインラインスタイルとして付与（無効化可能）。
- **再計算対応**: 既存の `<wbr>` 要素がある場合でも、最新の設定に基づき破綻なく改行位置を再計算します。

## インストール

```bash
pnpm add -D @wakamejs/astro @wakamejs/sudachi @wakamejs/core
# または
npm install -D @wakamejs/astro @wakamejs/sudachi @wakamejs/core
# または
yarn add -D @wakamejs/astro @wakamejs/sudachi @wakamejs/core
```

## 使い方

### `astro.config.mjs` での設定

[`@wakamejs/sudachi`](../sudachi) と組み合わせて使用する設定例です：

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

## API リファレンス

### `wakameIntegration(options)` (デフォルトエクスポート)

Astro インテグレーションを生成します。

#### オプション (`WakamePluginOptions`)

| オプション       | 型                  | デフォルト値 | 説明                                                                                                            |
| :--------------- | :------------------ | :----------- | :-------------------------------------------------------------------------------------------------------------- |
| `tokenizer`      | `Tokenizer<string>` | **必須**     | テキスト分割を行うトークナイザー実装                                                                            |
| `dictionary`     | `DictionaryInput`   | `undefined`  | トークナイザーに渡すカスタム辞書                                                                                |
| `applyWrapStyle` | `boolean`           | `true`       | `true` の場合、変換対象要素に `word-break: keep-all; overflow-wrap: break-word;` をインラインスタイルとして付与 |

### 再エクスポート

- `transformHtml`: [`@wakamejs/vite`](../vite) から再エクスポートされた HTML 変換関数

## 対応環境

- **Node.js**: >= 22.12.0
- **Astro**: ^6.0.0 || ^7.0.0

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/sudachi`](../sudachi): Sudachi トークナイザー
- [`@wakamejs/vite`](../vite): Vite プラグイン

## ライセンス

MIT
