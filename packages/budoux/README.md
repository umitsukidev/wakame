# @wakamejs/budoux

[BudouX](https://github.com/google/budoux) を使って Wakame のテキストを意味的なまとまりへ分割するトークナイザーです。BudouX の公式 parser が返す文字列配列を、そのまま `@wakamejs/core` の `Tokenizer<string, string>` として利用できます。

## インストール

```bash
pnpm add @wakamejs/budoux @wakamejs/core
```

## 使い方

```typescript
import { createWakame } from "@wakamejs/core";
import { createBudouxTokenizer } from "@wakamejs/budoux";

const wakame = createWakame({
    tokenizer: createBudouxTokenizer({ language: "ja" }),
});

const tokens = await wakame.tokenize("これは日本語の文章です。");
// => ["これは", "日本語の", "文章です。"]
```

対応言語は `ja`（既定）、`zh-hans`、`zh-hant`、`th` です。BudouX の parser を注入する場合は、言語指定と同時には指定できません。

```typescript
const tokenizer = createBudouxTokenizer({
    parser: {
        parse(text) {
            return [text];
        },
    },
});
```

カスタム辞書は BudouX の parser API が受け付けないため、空でない辞書を渡すと明示的にエラーになります。

## API

### `createBudouxTokenizer(options?)`

`Tokenizer<string, string>` を返します。

- `language`: `"ja" | "zh-hans" | "zh-hant" | "th"`。既定値は `"ja"`。
- `parser`: `parse(text: string): string[]` を持つ BudouX parser。指定した場合は `language` を指定できません。

## 対応環境

- Node.js: >= 20

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/vite`](../vite): Vite 向け HTML 変換プラグイン

## ライセンス

MIT
