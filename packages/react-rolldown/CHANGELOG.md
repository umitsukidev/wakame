# @wakamejs/react-rolldown

## 0.2.1

### Patch Changes

- 11b0de4: Viteの各environmentでruntime tokenizer moduleを起動時から依存最適化対象へ含め、SSR実行中の遅延再最適化によってReactが重複ロードされ、Invalid hook callが発生する問題を修正しました。

## 0.2.0

### Minor Changes

- 5d45674: 汎用の runtime tokenizer descriptor と同期 runtime segmentation を追加し、React向けRolldown・ViteプラグインがSSRとhydrationの両方で静的・動的なJSXテキストへゼロ幅スペースを挿入できるようにしました。

    React連携は `<wbr>` の代わりにU+200Bを使用し、カスタムコンポーネントのchildrenを走査します。コンポーネント名による除外とruntime dictionaryにも対応し、CSSやJSX attributesを自動付与しません。

### Patch Changes

- Updated dependencies [5d45674]
    - @wakamejs/core@0.2.0

## 0.1.1

### Patch Changes

- 29db7f4: Update dependencies.
