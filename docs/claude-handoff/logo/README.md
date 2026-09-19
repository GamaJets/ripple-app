# Repple logo asset pack

This directory contains the reusable Repple corporate logo and explains how it relates to the three existing app icons.

## Included corporate assets

| File | Use |
|---|---|
| `repple-logo-horizontal-primary.svg` | Default website, document, presentation, and light-background logo |
| `repple-logo-horizontal-white.svg` | Dark backgrounds, video, signage, and dark marketing layouts |
| `repple-logo-horizontal-mono.svg` | Single-color print, engraving, embroidery, stamps, and vendor conversion |
| `repple-logo-horizontal-mono.eps` | Legacy print/vendor workflow |
| `repple-mark-primary.svg` | Small corporate mark on light backgrounds |
| `repple-mark-white.svg` | Small corporate mark on dark backgrounds |

The SVG wordmarks use vector paths rather than live text. Claude Code, browsers, Figma, Illustrator, Affinity, Canva, and print vendors can use them without needing a font installed.

## Existing app-icon masters

The three shipped app identities remain in the repository and should be included when handing the pack to Claude:

- `assets/repple-icon-master.svg` — Repple Client
- `assets/repple-icon-coach.svg` — Repple Coach
- `assets/repple-icon-studio.svg` — Repple Studio
- `assets/icon.png`, `assets/icon-coach.png`, `assets/icon-studio.png` — 1024 px store-ready PNGs

The corporate angular `R` lockup is used for the website and marketing. The concentric ripple tiles are the established app-icon family. Do not silently replace shipped app icons with the corporate mark; that is a separate release/brand decision.

## Brand colors

- Night: `#06130F`
- Ink: `#0B1D19`
- Signal green: `#35E59C`
- Member identity: `#20B7A5`
- Coach identity: `#665FE8`
- Studio identity: `#D88C0B`
- White: `#FFFFFF`

In the apps, theme tokens and tenant overrides remain authoritative. Do not hardcode these colors into shared white-label components.

## Usage rules

1. Use the horizontal logo when there is room; use the mark alone only at small sizes.
2. Keep clear space around the logo equal to at least half the mark's height.
3. Minimum recommended horizontal-logo width: 120 px on screen or 32 mm in print.
4. Minimum recommended mark width: 24 px on screen or 8 mm in print.
5. Do not stretch, rotate, outline, add effects, recolor individual letters, or place the primary logo on a low-contrast background.
6. Use the mono asset when a printer, embroiderer, engraver, or promotional-product vendor requires one ink.
7. Keep the green signal green in full-color corporate uses. Use the mono asset when only one color is available.
8. Export final print artwork as PDF/X or outlined EPS from the supplied SVG master at the vendor's requested size and color profile.

## Claude Code integration examples

Website HTML:

```html
<a href="/" aria-label="Repple home">
  <img src="/assets/brand/repple-logo-horizontal-white.svg" alt="Repple" width="170" height="32">
</a>
```

React/Expo image asset:

```tsx
import ReppleLogo from '../assets/brand/repple-logo-horizontal-primary.svg';

<ReppleLogo width={170} height={32} accessibilityLabel="Repple" />
```

If the Expo SVG transformer is not configured, keep the current in-app brand component and use these files for the web, exported imagery, documents, and marketing rather than adding a new dependency only to display the logo.
