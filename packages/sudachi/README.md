# @wakamejs/sudachi

日本語形態素解析エンジン [Sudachi](https://github.com/WorksApplications/sudachi.rs) を利用した Wakame 向けの高精度トークナイザーです。

Rust 実装の Sudachi と [napi-rs](https://napi.rs/) によるネイティブバインディングを採用しており、高速に動作します。また、システム辞書を同梱しているため、追加の辞書設定なしですぐに使用できます。

## 特徴

- **高速なネイティブ実行**: Rust 実装の Sudachi を Node.js ネイティブアドオンとして呼び出します。
- **辞書同梱**: Sudachi のフルシステム辞書（full / system.dic）を同梱しており、辞書の別途インストールが不要です。
- **柔軟な分割モード**: Sudachi の分割モード（Aモード / Bモード / Cモード）に対応しています。
- **文節・助詞グルーピング**:
    - `bunsetsu`: UniDic の品詞体系（自立語・付属語・接頭辞・接尾辞）に基づき、自然な文節単位で単語を結合します。
    - `particle`: 助詞の直前までを1つの単位として結合します。
- **禁則処理（JIS X 4051 準拠）**: 括弧や句読点などの行頭禁則・行末禁則文字を考慮して適切に結合します。

## インストール

```bash
pnpm add @wakamejs/sudachi @wakamejs/core
# または
npm install @wakamejs/sudachi @wakamejs/core
# または
yarn add @wakamejs/sudachi @wakamejs/core
```

## 使い方

### 基本的な使い方

```typescript
import { createWakame } from "@wakamejs/core";
import { createSudachiTokenizer } from "@wakamejs/sudachi";

// トークナイザーの作成（デフォルト: 分割モードC）
const tokenizer = await createSudachiTokenizer();

const wakame = createWakame({ tokenizer });
const tokens = await wakame.tokenize("東京都知事選挙");
console.log(tokens);
// => ['東京都知事選挙'] (モードCの場合)
```

### 文節グルーピングと禁則処理の指定

日本語の自然な改行位置（`<wbr>` 挿入）を実現するには、文節グルーピングと禁則処理の併用が推奨されます。

```typescript
import { createWakame } from "@wakamejs/core";
import { createSudachiTokenizer } from "@wakamejs/sudachi";

const tokenizer = await createSudachiTokenizer({
    splitMode: "C",
    grouping: "bunsetsu", // 文節単位でグルーピング
    kinsoku: true, // 禁則文字（「」や、。など）の折り返し防止結合
});

const wakame = createWakame({ tokenizer });
const tokens = await wakame.tokenize("「私は東京の大学に通っています。」");
console.log(tokens);
// => ['「私は', '東京の', '大学に', '通っています。」']
```

## API リファレンス

### `createSudachiTokenizer(options?)`

Sudachi トークナイザーインスタンスを非同期で生成します。

#### オプション (`CreateSudachiTokenizerOptions`)

| オプション  | 型          | デフォルト値 | 説明                                                                                         |
| :---------- | :---------- | :----------- | :------------------------------------------------------------------------------------------- |
| `splitMode` | `"A"        | "B"          | "C"`                                                                                         | `"C"`                                                                                                              | Sudachi の形態素分割モード。<br>・`"A"`: 短単位（最も細かい分割）<br>・`"B"`: 中間単位<br>・`"C"`: 長単位（複合語などを1単語として扱う） |
| `grouping`  | `"particle" | "bunsetsu"`  | `undefined`                                                                                  | 単語のグルーピング方式。<br>・`"bunsetsu"`: 自立語・付属語情報に基づく文節単位結合<br>・`"particle"`: 助詞単位結合 |
| `kinsoku`   | `boolean`   | `false`      | `true` の場合、JIS X 4051 準拠の禁則処理を適用（行頭禁則文字・行末禁則文字を前後の語と結合） |

## 対応環境

- **Node.js**: >= 20
- **プラットフォーム**:
    - macOS (arm64)
    - Linux (x86_64, aarch64)
    - Windows (x86_64, aarch64)

## 関連パッケージ

- [`@wakamejs/core`](../core): Wakame コアパッケージ
- [`@wakamejs/vite`](../vite): Vite 向け HTML 変換プラグイン
- [`@wakamejs/astro`](../astro): Astro 向けインテグレーション

## ライセンス

- MIT
- Sudachi システム辞書に関するライセンス情報は同梱の `SUDACHI_DICT_LEGAL` および `THIRD_PARTY_NOTICES.md` をご確認ください。
