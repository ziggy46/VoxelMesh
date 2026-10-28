# VoxelMesh design system

Operate surface: a 3D print preparation tool. Written from the built interface (frosted dark glass, emerald accent, chosen by the user).

## Idea
The 3D model owns the whole window. Controls float over it as frosted glass panels instead of boxed columns. Left panel: source, printer, scale, filters, relief. Right panel: filament slots and export. View-mode pill top centre. Below 1024 px everything stacks: preview first, panels below.

## Tokens (web/src/index.css, `@theme`)
- **Scene:** `--color-scene #070b10` with an emerald bloom above the plate, a cool glow low right, and a 22 px dot grid (`.stage`).
- **Glass:** `--color-glass rgba(14,20,27,.74)`, 24 px blur, 150% saturation, 1 px `--color-line` edge, inner top highlight, two offset shadows. Solid fallback where `backdrop-filter` is unsupported.
- **Ink:** `--color-ink #edf2f7`, `--color-ink-2 #c5d0db`, `--color-muted #94a3b2` (6:1 or better on the glass).
- **Accent:** emerald `#34d399` / `#10b981`, text on it `#04251b`; `--color-accent-soft` for selected states. Status: ok `#4ade80`, warn `#fbbf24`, bad `#fb7185`, always with an icon and words.
- **Type:** system UI stack only (no web fonts). 13 px base, 17 px brand, 11 to 13 px labels. Monospace only for numbers and filenames; `.num` gives tabular figures.
- **Radius:** panels 22 px, controls 12 px, tiles 14 px, pills full.

## Components (kit in `web/src/ui/kit.tsx`, classes in `index.css`)
- `.glass` panel; `.ctl` control surface; `.btn-primary` (emerald gradient, one per panel); `.seg` segmented control (selected = accent-soft with a 1 px accent ring); `.switch` toggle; `.tile` selectable card.
- `Section` (icon chip + sentence-case title, hairline between sections), `SwitchRow`, `Segmented`, `Notice` (icon + words).
- One drawn icon set, 1.75 stroke, `currentColor`. No glyph or emoji icons.
- Slots: swatch (opens the native colour picker), name and hex, usage bar in the slot colour, chevron to expand members with a reassign select.

## Motion
One authored moment: panels and the empty-state card settle in (`.rise`, 520 ms exponential ease-out). Hover and press states are 160 ms. A spinner shows while meshing. Everything stops under `prefers-reduced-motion`.

## Browser surfaces themed
Selection colour, caret, focus ring (2 px emerald), thin scrollbars, range slider track and thumb, select and colour inputs.

## Rules
- Glass is a layer over the scene, not decoration on top of flat panels; panels never nest.
- No label above a heading, no gradient text, no coloured side borders, no hard offset shadows.
- Keep it local-only: no remote fonts, images or scripts (CSP `default-src 'none'` in the production build).
- A new control reuses `.ctl`, `.seg`, `.switch` or `.tile` rather than inventing a style.
