# Icon libraries for the Telegram finance Mini App

## Recommendation

Use `lucide-react` for the product UI. Its consistent outline set fits a dense finance dashboard, icons are individually imported SVG React components, and the package declares ESM output with `sideEffects: false`. It works in Next.js Server and Client Components. Keep decorative icons in Server Components when possible. A component needs `'use client'` only when its own state, event handlers, or browser APIs require it.

`@heroicons/react` is the best alternative if the interface should use filled selected states alongside outline navigation and action icons. Both are small, permissively licensed choices when imported by name.

## Comparison

| Library | Install and import | Next.js and bundle notes | License | Visual fit |
| --- | --- | --- | --- | --- |
| `lucide-react` | `npm install lucide-react`; `import { WalletCards, Receipt } from 'lucide-react'` | React components with ESM and CommonJS builds; `sideEffects: false`. Named static imports let the bundler remove unused icons. Avoid Lucide's dynamic icon loader in the main Mini App path because it imports all icons and defeats this benefit. | ISC, with named Feather-derived icons under MIT. | Clean 24px outline icons with configurable stroke width. The most even match for transactions, budgets, accounts, navigation, and compact action controls. |
| `@heroicons/react` | `npm install @heroicons/react`; `import { WalletIcon } from '@heroicons/react/24/outline'` | React package exposes ESM and CommonJS paths and declares `sideEffects: false`. Import from a size and style path: `24/outline`, `24/solid`, `20/solid`, or `16/solid`. Named imports are the normal tree-shakeable form. | MIT. | Polished 24px outline and solid sets, plus smaller solid sets. Good when selected tabs, status, or primary actions should be visibly filled. |
| `@radix-ui/react-icons` | `npm install @radix-ui/react-icons`; `import { DashboardIcon } from '@radix-ui/react-icons'` | ESM and CommonJS builds with `sideEffects: false`; named imports are appropriate. No Next.js-specific integration is needed. | MIT. | A crisp, deliberately small 15px set for interface chrome. Strong for compact menus and controls, but too limited as the Mini App's only finance icon source. |
| `react-icons` | `npm install react-icons`; `import { FaWallet } from 'react-icons/fa6'` | ESM and CommonJS subpath exports with `sideEffects: false`. Import individual named icons from one pack subpath, never an entire pack. The project says ES6 imports include only used icons. | Package is MIT. Each upstream icon set keeps its own license, so a mixed selection needs license review. | A wrapper around many unrelated sets. Useful for a one-off brand mark or a missing glyph, but it makes a finance UI look inconsistent unless one source set is enforced. |
| `hugeicons-react` | Do not install. The publisher marks it deprecated. | Legacy package is not maintained. Its replacement uses `npm install @hugeicons/react @hugeicons/core-free-icons`, then passes a statically imported icon definition to `HugeiconsIcon`. Both replacement packages publish ESM and declare `sideEffects: false`. | The maintained renderer and free pack are MIT. | The free pack uses Stroke Rounded and has much broader coverage than the first three options. It is viable when its rounded, more expressive style is intentional, but adds a renderer plus a large icon-definition package. |

## Iconify

`@iconify/react` is not a first choice for this Mini App. It is a React component library with ESM and CommonJS exports, but Iconify's value is access to many independent icon sets rather than one coherent visual language. That also means licensing follows the selected icon set, not only Iconify's MIT component license. Use it only when a required brand or specialist icon is unavailable from the chosen primary set, and bundle the icon data rather than relying on a runtime API fetch.

## Next.js guidance

All maintained candidates above are React SVG component packages with published ESM builds. They can render during Next.js SSR and in the App Router's Server Components. Static named imports are the safe default for a mobile Mini App: they give the bundler a concrete set of icons to include. Avoid runtime icon-name lookup, broad namespace imports, and mixed icon families in navigation.

For this dashboard, use one 20px or 24px outline language for neutral navigation and row actions. Use color, labels, and amounts to communicate financial status rather than mixing in unrelated filled or branded icon sets. Add a short accessible label to icon-only controls. Decorative SVGs should be hidden from assistive technology.

## Sources

All sources below are official project documentation, source repositories, or npm package metadata.

- [Lucide React README](https://github.com/lucide-icons/lucide/blob/main/packages/lucide-react/README.md)
- [Lucide React package metadata](https://github.com/lucide-icons/lucide/blob/main/packages/lucide-react/package.json)
- [Lucide license](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
- [Heroicons README and React usage](https://github.com/tailwindlabs/heroicons#react)
- [Heroicons React package metadata](https://github.com/tailwindlabs/heroicons/blob/master/react/package.json)
- [Heroicons license](https://github.com/tailwindlabs/heroicons/blob/master/LICENSE)
- [Radix Icons README](https://github.com/radix-ui/icons/blob/master/README.md)
- [Radix React Icons npm metadata](https://registry.npmjs.org/@radix-ui/react-icons/latest)
- [Radix Icons license](https://github.com/radix-ui/icons/blob/master/LICENSE)
- [React Icons README](https://github.com/react-icons/react-icons/blob/master/README.md)
- [React Icons npm metadata](https://registry.npmjs.org/react-icons/latest)
- [Hugeicons legacy React README](https://github.com/hugeicons/hugeicons-react/blob/master/README.md)
- [Hugeicons React npm metadata](https://registry.npmjs.org/@hugeicons/react/latest)
- [Hugeicons free icon pack npm metadata](https://registry.npmjs.org/@hugeicons/core-free-icons/latest)
- [Hugeicons MIT license](https://github.com/hugeicons/hugeicons-react/blob/master/LICENSE.md)
- [Iconify React npm metadata](https://registry.npmjs.org/@iconify/react/latest)
- [Iconify license](https://github.com/iconify/iconify/blob/master/license.txt)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
