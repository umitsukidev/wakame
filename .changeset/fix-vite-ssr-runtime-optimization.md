---
"@wakamejs/react-rolldown": patch
---

Viteの各environmentでruntime tokenizer moduleを起動時から依存最適化対象へ含め、SSR実行中の遅延再最適化によってReactが重複ロードされ、Invalid hook callが発生する問題を修正しました。
