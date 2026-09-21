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

組み込み言語モデルで作成した tokenizer には、React のビルド時変換などで利用できる `runtime` descriptor も付属します。`parser` を注入した tokenizer は実行時モジュールへシリアライズできないため、動的 JSX テキストのランタイム変換には利用できません。

## API

### `createBudouxTokenizer(options?)`

`Tokenizer<string, string>` を返します。

- `language`: `"ja" | "zh-hans" | "zh-hant" | "th"`。既定値は `"ja"`。
- `parser`: `parse(text: string): string[]` を持つ BudouX parser。指定した場合は `language` を指定できません。

### `@wakamejs/budoux/runtime`

`createBudouxRuntimeTokenizer(options?)` は、ビルド時に生成されたモジュールから利用する同期 segmenter を返します。`segment(text)` は組み込み BudouX モデルのトークン配列を返します。

## 対応環境

- Node.js: >= 20

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/vite`](../vite): Vite 向け HTML 変換プラグイン

## ライセンス

MIT
