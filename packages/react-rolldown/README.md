# @wakamejs/react-rolldown

React の JSX をビルド時に解析し、日本語テキストを意味的な単位へ分割して自然な折り返し位置に `<wbr />` を挿入する Rolldown プラグインです。サーバー用とクライアント用のバンドルに同じ静的変換を適用するため、SSR の HTML と hydration の結果を一致させられます。

## インストール

```bash
pnpm add -D @wakamejs/react-rolldown @wakamejs/core @wakamejs/sudachi
# または
npm install -D @wakamejs/react-rolldown @wakamejs/core @wakamejs/sudachi
```

トークナイザーの実装（[`@wakamejs/sudachi`](../sudachi) など）と Rolldown も必要です。

## 使い方

Rolldown の設定でプラグインを登録します。

```typescript
import { defineConfig } from "rolldown";
import wakameReactPlugin from "@wakamejs/react-rolldown";
import { createSudachiTokenizer } from "@wakamejs/sudachi";

const tokenizer = await createSudachiTokenizer({
    grouping: "bunsetsu",
    kinsoku: true,
});

export default defineConfig({
    plugins: [wakameReactPlugin({ tokenizer })],
});
```

たとえば、次の JSX はビルド時にトークンごとの式と `<wbr />` へ変換されます。

```tsx
export function Heading() {
    return <h1>自然な日本語の折り返し</h1>;
}
```

変換結果の例：

```tsx
<h1>
    {"自然な"}
    <wbr />
    {"日本語の"}
    <wbr />
    {"折り返し"}
</h1>
```

## API リファレンス

### `wakameReactPlugin(options)`（デフォルトエクスポート）

JSX/TSX モジュールを Babel の公開 AST API で変換する Rolldown プラグインを生成します。デフォルトでは `node_modules` と、カスタムコンポーネント・編集可能要素・`pre`・`code`・SVG・MathML などの内容を変換しません。

#### オプション（`ReactRolldownPluginOptions`）

| オプション        | 型                                         | デフォルト値         | 説明                                                             |
| :---------------- | :----------------------------------------- | :------------------- | :--------------------------------------------------------------- |
| `tokenizer`       | `Tokenizer<string, string>`                | **必須**             | テキストを分割するトークナイザー実装                             |
| `dictionary`      | `DictionaryInput`                          | `undefined`          | トークナイザーへ渡すカスタム辞書                                 |
| `include`         | `string \| RegExp \| (string \| RegExp)[]` | `/\.[jt]sx/`         | 変換対象モジュールのフィルター                                   |
| `exclude`         | `string \| RegExp \| (string \| RegExp)[]` | `undefined`          | 変換から除外するモジュールのフィルター                           |
| `ignoreAttribute` | `string`                                   | `data-wakame-ignore` | この属性を持つ要素を除外                                         |
| `parserPlugins`   | `ParserPlugin[]`                           | `[]`                 | Babel parser に追加する構文プラグイン（例: `decorators-legacy`） |

`include` と `exclude` の文字列は glob として扱われます。`data-wakame-ignore`、`contentEditable`、`dangerouslySetInnerHTML` を持つ要素もスキップされます。

## 対応環境

- **Node.js**: >= 20
- **Rolldown**: ^1.0.0
- **React**: ^18.0.0 または ^19.0.0（利用する React プロジェクト側で用意）

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/sudachi`](../sudachi): Sudachi トークナイザー
- [`@wakamejs/vite`](../vite): HTML を変換する Vite プラグイン
- [`@wakamejs/astro`](../astro): Astro インテグレーション

## ライセンス

MIT
