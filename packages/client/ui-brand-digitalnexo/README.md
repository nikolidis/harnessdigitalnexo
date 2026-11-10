---
description: "Digital Nexo brand occupants for the sidebar and the start screen; for maintainers of the Digital Nexo distribution changing or replacing its logo."
kind: "package-reference"
---

# @digitalnexo/dsh-client-ui-brand

## Summary

This package gives the Web client the Digital Nexo identity: a square "D." tile in the sidebar brand row, the collapsed rail, and the start screen, and the "DIGITALNEXO." wordmark beside the expanded sidebar mark. It replaces [`dsh-client-ui-brand-official`](../ui-brand-official/README.md), which this distribution leaves unmounted. It has no runtime state, registers whatever the build profile is, and does not affect model requests.

## Use this package

The row is mounted by [`packages/bundle/web-app/digitalnexo.patch.yml`](../../bundle/web-app/digitalnexo.patch.yml), which also disables the official brand row. Nothing else is needed: occupying a slot is the only composition route, and there is no brand configuration surface here.

| Slot | Occupant | Where it shows |
|---|---|---|
| `sidebar.brand.mark` | square tile | expanded brand row and collapsed rail, 24px |
| `sidebar.brand.name` | wordmark | beside the expanded mark, 12px tall |
| `conversation.hero.brand.mark` | square tile | before the start-screen headline, 34px |

The browser tab title, the favicon, and the installable-app icons are outside the slot system. The title comes from `DISTRIBUTION_CLIENT_TITLE` in [`scripts/client-build-environment.ts`](../../../scripts/client-build-environment.ts); the icons live in [`apps/web/public`](../../../apps/web/public).

## Change the logo

The artwork in [`src/client/artwork.ts`](src/client/artwork.ts) is generated. It reproduces the logo of the Digital Nexo website, which is text rather than an image file: "DIGITALNEXO" in Inter ExtraBold with `letter-spacing: -0.05em`, followed by a period in the site's accent colour. The square "D." tile is derived from that wordmark for the places that need a compact mark; the website itself has no icon.

To regenerate the artwork, the favicons, and the app icons after changing the text, the font, or the colours, follow [`digitalnexo/brand/README.md`](../../../digitalnexo/brand/README.md). To use a different logo altogether, replace the path data in `artwork.ts` and the files in `apps/web/public`; the components only need a width, a height, and path data.

Colours are set in [`src/client/Brand.module.css`](src/client/Brand.module.css). The lettering follows the shell's primary label token, so it keeps its contrast in the light and dark themes; the accent is `#754740` on light surfaces and `#e59c8f` on dark ones.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The hero mark is static.** The official start screen animates its fish on hover; this occupant does not adopt the host's animation class, because a swaying tile reads as a defect.
- **The Desktop application keeps its upstream icons.** `apps/desktop` installer art, tray icons, and window icons are untouched; this distribution is built and verified as the Web application.
