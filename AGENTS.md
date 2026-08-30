# コマンド実行

- `pnpm` と `cargo` を使うコマンドは、install、build、check、test、fmtを含め、必ずサンドボックス外で実行してください。

# TypeScript / JavaScript

- 配列を反復するために `for (;;)` 形式のインデックスループを使わず、`for...of` などの反復構文を使ってください。

# Rust

- importは現在のコードと同様に、同じcrate rootからの項目を個別の`use`文へ分散させず、可能な範囲で1つのimport treeへまとめてください。
- 同じcrate内の複数モジュールをimportするときは、ネストしたimport treeを使って関係が分かる形にしてください。例えば、標準ライブラリは`use std::{fs::File, sync::Arc};`、Sudachi関連は`use sudachi::{ ... };`のようにまとめます。
- importを変更したRustコードは、サンドボックス外で`cargo fmt`を実行し、現在の整形状態に合わせてください。
