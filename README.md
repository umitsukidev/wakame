# Wakame

Wakame は、日本語テキストを意味的な単位（文節など）で分割し、自然な折り返し位置に `<wbr>` を挿入することで、Web サイトやアプリケーションにおける日本語の可読性を高めるツールキットです。

## パッケージ

本リポジトリは monorepo 構成です。各パッケージの詳細や利用方法はそれぞれの README をご覧ください。

- [`@wakamejs/core`](./packages/core): コアインターフェースおよびオーケストレーション機能
- [`@wakamejs/sudachi`](./packages/sudachi): 形態素解析エンジン Sudachi を用いた高精度トークナイザー（辞書同梱）
- [`@wakamejs/vite`](./packages/vite): HTML に `<wbr>` を自動挿入する Vite プラグイン
- [`@wakamejs/astro`](./packages/astro): Astro サイト向けインテグレーション

## 開発

本プロジェクトは pnpm ワークスペースを用いた monorepo です。

```bash
pnpm install
```

## ライセンス

[MIT](./LICENSE)
