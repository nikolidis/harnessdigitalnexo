# Digital Nexo brand tools

Two small scripts that produce every Digital Nexo brand asset in this repository. They are not part of the pnpm workspace and nothing in the build depends on them; the generated files are committed.

## Where the logo comes from

The Digital Nexo website draws its logo as text, not as an image: `DIGITALNEXO` in Inter ExtraBold with `letter-spacing: -0.05em`, followed by a period in the accent colour (`--accent: oklch(0.45 0.065 30)`, `#754740`). `gen.mjs` converts exactly that recipe into vector outlines, so the logo renders the same on a machine that does not have the font. The square "D." tile is derived from the wordmark for the places that need a compact mark (favicon, app icons, collapsed sidebar); the website has no icon of its own.

Inter is licensed under the SIL Open Font License 1.1, which allows converting its glyphs to outlines for a logo.

## Regenerate

```sh
# 1. Only when the text, font, weight, or tracking changes: rebuild the outlines.
cd digitalnexo/brand
npm install
node gen.mjs                 # rewrites logo.json

# 2. Rebuild artwork.ts, the favicons, and the app icons from logo.json.
cd ../..
node digitalnexo/brand/build-assets.mjs
pnpm run build
```

`build-assets.mjs` renders the PNG icons with the Chromium that Playwright installs (`pnpm exec playwright install chromium`). Set `DIGITALNEXO_CHROME=/path/to/chrome` to use an installed Chrome instead. Pass a folder as the first argument to write everything there for review without touching the repository.

## What each file is

| File | Role |
|---|---|
| `gen.mjs` | Inter ExtraBold → outlines for the wordmark and the "D." monogram (`logo.json`) |
| `logo.json` | The outlines, with the font version they came from |
| `build-assets.mjs` | `logo.json` → `artwork.ts`, `favicon*.svg`, `icon-*.png`, `apple-touch-icon.png` |

Colours used by the icons are constants at the top of `build-assets.mjs`; colours used inside the application are in `packages/client/ui-brand-digitalnexo/src/client/Brand.module.css`.
