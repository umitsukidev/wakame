# @wakamejs/react-rolldown

React の JSX をビルド時・実行時に解析し、日本語テキストを BudouX などの意味的な単位へ分割して境界にゼロ幅スペース（U+200B）を挿入する Rolldown/Vite プラグインです。サーバー用とクライアント用のバンドルに同じ変換を適用するため、SSR の HTML と hydration の結果を一致させられます。

## インストール

```bash
pnpm add @wakamejs/core @wakamejs/budoux
pnpm add -D @wakamejs/react-rolldown
# または
npm install @wakamejs/core @wakamejs/budoux
npm install -D @wakamejs/react-rolldown
```

トークナイザーの実装（[`@wakamejs/budoux`](../budoux) など）と Rolldown または Vite も必要です。

## 使い方

Rolldown の設定でプラグインを登録します。

```typescript
import { defineConfig } from "rolldown";
import wakameReactPlugin from "@wakamejs/react-rolldown";
import { createBudouxTokenizer } from "@wakamejs/budoux";

const tokenizer = createBudouxTokenizer({ language: "ja" });

export default defineConfig({
    // Vite でも同じくトップレベル plugins に登録できます。
    plugins: [wakameReactPlugin({ tokenizer })],
});
```

Vite では次のように、他の wrapper plugin を作らずトップレベルの `plugins` に登録します。

```typescript
import { defineConfig } from "vite";
import { createBudouxTokenizer } from "@wakamejs/budoux";
import wakameReactPlugin from "@wakamejs/react-rolldown";

const tokenizer = createBudouxTokenizer({ language: "ja" });

export default defineConfig({
    plugins: [wakameReactPlugin({ tokenizer })],
});
```

たとえば、次の JSX はビルド時にトークン境界を含む文字列式へ変換されます。

```tsx
export function Heading() {
    return <h1>自然な日本語の折り返し</h1>;
}
```

変換結果の例：

```tsx
<h1>{"自然な\u200B日本語の\u200B折り返し"}</h1>
```

静的な JSX テキストと静的な文字列式はビルド時に処理され、動的な JSX 式は tokenizer の runtime descriptor から生成した同期 helper で処理されます。文字列を含む配列も再帰的に処理し、既に U+200B を含む文字列は重複処理しません。動的 JSX を使う場合は、組み込み言語モデルを持つ [`@wakamejs/budoux`](../budoux) など runtime descriptor 対応 tokenizer を使用してください。

## API リファレンス

### `wakameReactPlugin(options)`（デフォルトエクスポート）

JSX/TSX モジュールを Babel の公開 AST API で変換する Rolldown プラグインを生成します。デフォルトでは `node_modules` と、編集可能要素・`pre`・`code`・SVG・MathML などの安全でない subtree を変換しません。カスタムコンポーネントも走査し、その直接の静的テキストと子孫の安全な要素を変換します。

変換対象は除外されていない JSX 要素の直接の `JSXText` と静的な文字列式です。`<span>` などの子要素をまたぐテキストは結合せず、各ノードを個別に処理します。動的な式は runtime helper で文字列だけを処理し、その他の ReactNode はそのまま保持されます。

#### オプション（`ReactRolldownPluginOptions`）

| オプション        | 型                                         | デフォルト値         | 説明                                                             |
| :---------------- | :----------------------------------------- | :------------------- | :--------------------------------------------------------------- |
| `tokenizer`       | `Tokenizer<string, string>`                | **必須**             | テキストを分割するトークナイザー実装                             |
| `dictionary`      | `DictionaryInput`                          | `undefined`          | トークナイザーへ渡すカスタム辞書                                 |
| `include`         | `string \| RegExp \| (string \| RegExp)[]` | `/\.[jt]sx/`         | 変換対象モジュールのフィルター                                   |
| `exclude`         | `string \| RegExp \| (string \| RegExp)[]` | `undefined`          | 変換から除外するモジュールのフィルター                           |
| `ignoreAttribute` | `string`                                   | `data-wakame-ignore` | この属性を持つ要素を除外                                         |
| `ignore`          | `readonly string[]`                        | `[]`                 | 指定した JSX コンポーネント名とその subtree を除外               |
| `parserPlugins`   | `ParserPlugin[]`                           | `[]`                 | Babel parser に追加する構文プラグイン（例: `decorators-legacy`） |

`include` と `exclude` の文字列は glob として扱われます。`data-wakame-ignore`、`contentEditable`、`dangerouslySetInnerHTML` を持つ要素もスキップされます。

`ignore` には JSX 名を完全一致で指定します。識別子は `PageLayout`、メンバー名は `Namespace.Component`、名前空間名は `Namespace:Component` の形式です。指定したコンポーネントは直接のテキストと子孫をすべてスキップします。

JSX の子は親より先に評価されるため、親コンポーネントに付けた ignore marker で、別にレンダリングされるコンポーネント内部の文字列を後から元に戻すことはできません。確実に除外するには、直接処理する箇所に marker または `ignore` を指定してください。

このプラグインは自動で CSS を追加しません。必要な折り返しスタイルはアプリケーション側で指定してください。

## Roadmap

- BudouX の HTMLProcessor に合わせた inline 要素をまたぐ文脈の集約
- `<wbr>` 出力を選べる optional mode

## 対応環境

- **Node.js**: >= 20
- **Rolldown**: ^1.0.0
- **React**: ^18.0.0 または ^19.0.0（利用する React プロジェクト側で用意）

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/budoux`](../budoux): BudouX トークナイザーと runtime factory
- [`@wakamejs/vite`](../vite): HTML を変換する Vite プラグイン
- [`@wakamejs/astro`](../astro): Astro インテグレーション

## ライセンス

MIT
