# Minimalist Analysis — Porcelain UI specification

This is the implementation contract for the native WinForms redesign. The two reference renders in this folder are the visual source of truth:

- `porcelain-overview-wide.png`
- `porcelain-users-compact.png`

## Direction

Porcelain uses a cool neutral canvas (`#F4F4F6`) with a small number of true-white elevated surfaces. Hierarchy comes from typography, spacing, and restrained depth rather than borders around every region. System blue (`#007AFF`) is the only product accent; semantic colors appear as a small painted dot plus a readable state word.

The application remains native WinForms. UI text, tables, buttons, charts, search, navigation, and controls are code-native—not rasterized from the concepts.

## Design tokens

| Role | Value |
|---|---|
| Canvas | `#F4F4F6` |
| Surface | `#FFFFFF` |
| Sunken surface | `#F0F0F3` |
| Primary text | `#1D1D1F` |
| Secondary text | `#5B5B60` |
| Tertiary text | `#7E7E84` |
| Hairline | `#E4E4E9` |
| Strong hairline | `#D2D2D9` |
| Accent fill | `#007AFF` |
| Accent text | `#0066CC` |
| Accent tint | `#ECF5FF` |
| Healthy dot/text | `#34C759` / `#1E8038` |
| Warning dot/text | `#FF9F0A` / `#9E5C00` |
| Failure dot/text | `#FF453A` / `#B52D34` |
| Warning band | `#FFF6E5` with `#F0DFC2` line |
| Console | `#17181C` |
| Console raised/input | `#1F2026` / `#24252C` |
| Console ink/dim | `#EDEDF2` / `#8E8E97` |
| Console accent/success/error | `#59A8FF` / `#4ED675` / `#FF7A80` |

Typography uses Segoe UI Variable Display/Text with Segoe UI fallback. Monospaced text uses Cascadia Mono with Consolas fallback. Large titles are 22pt semibold (20pt Short), section titles 14pt semibold, metrics 26pt semibold (24pt Compact), body 9.75pt, and footnotes never smaller than 8.75pt.

Spacing is based on `4, 8, 12, 16, 20, 24, 32, 40`. Radii are 8 for inputs, 10 for selection pills, 12–16 for surfaces, and 18 for the dock. Shadows are soft and low-alpha; high-contrast mode disables shadows and uses system-color hairlines.

## Shell

- Slim white header: brand mark plus “Minimalist Analysis” at left; textual freshness state and compact Refresh action at right.
- Warning content is an auto-sized, wrapping band and collapses completely when empty.
- The active page owns its large title and subtitle inside the scrollable content. The header does not repeat page titles.
- Header and dock remain fixed. Page bodies scroll vertically only.
- The bottom dock is a compact, content-hugging white surface with five equal targets: Overview, Users, AI Control, Health, Console. It is centered, elevated, and never becomes a sidebar or icon-only menu.

## Responsive contract

- Compact: below 1120 logical pixels.
- Standard: 1120–1279.
- Wide: 1280 and above.
- Short: below 760 logical pixels high.
- Minimum window: 900 × 640.
- Content is capped near 1440 logical pixels on very wide displays.
- KPI layout is 2 × 2 in Compact and 1 × 4 otherwise.
- Overview, Users, and AI paired regions stack in Compact.
- Text-bearing rows auto-size; only charts, grids, console output, and similar visual objects have minimum heights.
- No horizontal page scrollbar is allowed.

## Allowed primary copy

Header: `Minimalist Analysis`, freshness state, `Refresh`.

Pages: `Overview`, `Users`, `AI Control`, `Health`, `Console` plus their existing descriptive subtitles.

Navigation: `Overview`, `Users`, `AI Control`, `Health`, `Console` in that order.

Overview metrics: `Registered users`, `Active now`, `Paid memberships`, `New users · 30d`.

The rebuild may refine concise explanatory copy already present in the app, but must not invent new metrics, commands, user data, administrator powers, marketing claims, badges, or decorative labels.

## Functional invariants

Every current handler, data-registration map, exact-UID row tag, search/copy action, AI mode/timeout/model lifecycle, bridge action, allowlisted console command, moderation confirmation, busy/cancel state, keyboard shortcut, privacy boundary, and responsive breakpoint remains intact. A visual primitive must never use `Tag` for layout state because directory rows use it for exact user identity.

## Fidelity checkpoints

1. Cool canvas and true-white surfaces match the concepts; no cream tint or gradients.
2. KPI values form one unified surface, not four independent cards.
3. The dock is compact, centered, elevated, and fully visible at 900 × 640.
4. Typography provides hierarchy without duplicated titles or tiny footnotes.
5. Charts, directory, recent activity, and console remain functional visual objects; status and explanatory regions use open space where possible.
6. All five tabs survive Compact/Standard/Wide and Short transitions without clipping, overlap, horizontal overflow, lost control identity, or stale data.
7. Focus, disabled, selected, hover, and pressed states remain visible; high contrast and reduced motion are respected.
8. Console chrome, output, command categories, and input read as one rounded dark surface. Only individual controls and the command field are raised; no nested full-width terminal slab is allowed.
