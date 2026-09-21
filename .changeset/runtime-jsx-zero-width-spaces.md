---
"@wakamejs/core": minor
"@wakamejs/budoux": minor
"@wakamejs/react-rolldown": minor
---

Add generic runtime tokenizer descriptors and synchronous runtime segmentation so the React Rolldown and Vite plugin can insert zero-width spaces into both static and dynamic JSX text during SSR and hydration.

The React integration now uses U+200B instead of `<wbr>`, traverses custom component children, supports ignored component names and runtime dictionaries, and requires no automatic CSS or JSX attributes.
