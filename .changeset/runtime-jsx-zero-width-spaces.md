---
"@wakamejs/core": minor
"@wakamejs/budoux": minor
"@wakamejs/react-rolldown": minor
---

汎用の runtime tokenizer descriptor と同期 runtime segmentation を追加し、React向けRolldown・ViteプラグインがSSRとhydrationの両方で静的・動的なJSXテキストへゼロ幅スペースを挿入できるようにしました。

React連携は `<wbr>` の代わりにU+200Bを使用し、カスタムコンポーネントのchildrenを走査します。コンポーネント名による除外とruntime dictionaryにも対応し、CSSやJSX attributesを自動付与しません。
