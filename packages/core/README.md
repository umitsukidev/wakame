# @wakamejs/core

Wakame のコアパッケージです。日本語テキストを意味的な単位へ分割し、自然な折り返し位置（`<wbr>` タグの挿入位置など）を決定するための基盤インターフェースとコア機能を提供します。

## 特徴

- **最小限のフットプリント**: 外部依存関係を持たない軽量な設計
- **プラガブルなトークナイザー**: `Tokenizer` インターフェースを実装することで、任意の形態素解析器やルールベースのトークナイザーを接続可能
- **辞書インターフェース**: カスタム辞書（単語セット）を扱うための正規化されたインターフェース

## インストール

```bash
pnpm add @wakamejs/core
# または
npm install @wakamejs/core
# または
yarn add @wakamejs/core
```

通常は、形態素解析器を提供するトークナイザーパッケージ（[`@wakamejs/sudachi`](../sudachi) など）や、フレームワーク統合パッケージ（[`@wakamejs/vite`](../vite)、[`@wakamejs/astro`](../astro)）と一緒に利用します。

## 使い方

```typescript
import { createWakame, type Tokenizer } from "@wakamejs/core";

// カスタムトークナイザーの例
const customTokenizer: Tokenizer<string> = {
    async tokenize(text, dictionary) {
        // 形態素解析や単語分割のロジック
        return text.split(/(?<=[、。])/);
    },
};

// Wakame インスタンスの作成
const wakame = createWakame({
    tokenizer: customTokenizer,
    dictionary: ["東京特許許可局"], // オプションのカスタム辞書
});

// テキストのトークナイズ
const tokens = await wakame.tokenize("こんにちは。今日は良い天気ですね。");
console.log(tokens);
```

## API リファレンス

### `createWakame(options)`

Wakame インスタンスを生成します。

#### オプション (`CreateWakameOptions<TToken, TEntry>`)

| プロパティ   | 型                          | 必須   | 説明                                                   |
| :----------- | :-------------------------- | :----- | :----------------------------------------------------- |
| `tokenizer`  | `Tokenizer<TToken, TEntry>` | はい   | トークナイズ処理を行う `Tokenizer` 実装                |
| `dictionary` | `DictionaryInput<TEntry>`   | いいえ | トークナイザーに渡すカスタム辞書（`Iterable<TEntry>`） |

### インターフェース

#### `Wakame<TToken>`

`createWakame` が返すオブジェクトです。

- `tokenize(text: string): Promise<readonly TToken[]>`: テキストをトークナイズしてトークンの配列を返します。

#### `Tokenizer<TToken, TEntry>`

トークナイザーパッケージが実装するインターフェースです。

- `tokenize(text: string, dictionary: Dictionary<TEntry>): Promise<readonly TToken[]>`: 指定されたテキストと正規化済み辞書を受け取り、トークン配列を返します。

#### `Dictionary<TEntry>`

トークナイザーに渡される正規化された辞書型です（`ReadonlySet<TEntry>`）。

#### `DictionaryInput<TEntry>`

`createWakame` のオプションに渡せる辞書型です（`Iterable<TEntry>`）。

## 関連パッケージ

- [`@wakamejs/sudachi`](../sudachi): Sudachi（形態素解析器）を用いたトークナイザー実装
- [`@wakamejs/vite`](../vite): Vite 向け HTML 変換プラグイン
- [`@wakamejs/astro`](../astro): Astro 向けインテグレーション

## ライセンス

MIT
