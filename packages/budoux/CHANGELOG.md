# @wakamejs/budoux

## 0.2.2

### Patch Changes

- 6452821: Update dependencies. Node.js requirements change to `>=22` for `@wakamejs/budoux` and `^22.18.0 || >=24.11.0` for `@wakamejs/react-rolldown`.

## 0.2.1

### Patch Changes

- 1c72375: Update dependencies.

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
