## 1. Design thesis

Searvia is the instrument that shows a brand the path it takes through search — and where that path breaks. The design system exists to make that path legible: to turn crawl data, rankings, competitor gaps, and AI-answer citations into calm, credible evidence a marketing lead can act on before lunch. Everything below is downstream of that job.

### 1.1 Design principles

1. **Evidence-first.** Every claim on screen is backed by a visible source — a checked URL, a captured SERP position, a cited AI answer, a timestamp. Decorative surfaces never outrank data. If we cannot prove it, we do not draw it as fact.
2. **Airy & premium.** Generous whitespace, restrained accent, near-black type on white and soft-gray. Density comes from typographic hierarchy and alignment, not from borders and boxes. The product should feel expensive and quiet.
3. **Honest-by-default.** The interface distinguishes *checked*, *not checked*, *manual review*, and *integration required* as first-class states. Nothing unverified is ever styled to look verified. Example figures are always captioned "Demo data."
4. **Path-as-metaphor.** The visibility path (§4) is the connective tissue: it begins at the URL input and threads through evidence, rankings, citations, and prioritized actions. It is a system, not an illustration — subtle in product, cinematic in marketing.
5. **Dense-but-readable.** SaaS operators live in tables, filters, and detail drawers all day. Line length, row rhythm, tabular numerals, and status legibility are tuned for eight-hour sessions, not first impressions.
6. **Directional & scannable.** Layouts move left-to-right, top priority first. Status is always communicated by icon + text + color together (§5.1), never color alone. The eye should find the worst problem in under three seconds.
7. **Original.** We reinterpret references (§2) into our own path/radar/scan-trace language. We never imitate a competitor's name, palette, wording, layout, or issue taxonomy (§18).
8. **Accessible as a feature.** WCAG 2.2 AA is a floor, not a ceiling. Keyboard operability, focus visibility, reduced-motion parity, and non-color status encoding are treated as product requirements with acceptance criteria.

### 1.2 Positioning statement

Searvia is *search + visibility + via* — the path through which people and AI systems discover a brand. The visual language makes that trinity literal: **search** is the URL input and scan (the origin of every journey), **visibility** is the evidence surfaced along the way (rankings, coverage, citations rendered as clear, honest data), and **via** is the directional rail — the continuous path that connects a raw domain to a prioritized, defensible action plan. Near-black type on airy white gives the evidence room to breathe; a single electric-indigo accent marks the live path and the next step to take; abstract radar and scan-trace motifs signal motion and discovery without a single magnifying glass, brain, or moon. The result reads as an evidence instrument, not a dashboard skin: premium, calm, and provably honest.

---

## 2. Reference reinterpretation

We borrow structural and cinematic *qualities* from https://www.21hrs.space/ — never its subject matter, textures, or composition. Each borrowed quality maps to one concrete Searvia decision.

### 2.1 Mapping table

| 21hrs.space quality | What it does there | Searvia reinterpretation (concrete decision) |
| --- | --- | --- |
| Cinematic layering | Foreground/midground/background stack builds depth | Marketing hero layers: (back) faint scan-grid at 4–6% opacity → (mid) the visibility-path rail → (front) URL input + evidence cards. Product keeps ≤2 layers max, no parallax. |
| Framed viewport | Content sits inside an inset "window" with margins as matte | Marketing sections use a framed viewport: `--container-xl` (1200px) inside a soft-gray matte (`--neutral-50`) with 1px hairline and 24px inset padding. Signals "instrument readout." |
| Oversized typography | Huge display type anchors each scene | Display scale up to 72–96px for hero and section openers only (§5.2). Product UI never exceeds `h2`. Oversized type is a marketing device, not a product one. |
| Scroll-driven reveals | Elements animate in as the viewport advances | Section content reveals on scroll via 12–16px translate + fade, `--ease-decelerate`, staggered ≤80ms. The visibility path "draws on" as you scroll (§6). All fully reduced-motion-safe. |
| Timeline / navigation cues | A side rail marks progress through the narrative | The visibility path *is* the timeline: waypoint nodes (URL → Evidence → Rankings → Citations → Actions) double as a sticky progress rail on marketing and a step indicator in product audits. |
| Spatial depth | Perceived Z-depth via scale, blur, shadow | Depth expressed only through the subtle elevation ramp (§5.7) and layered opacity — never heavy blur, never glow. Max elevation in product is `--shadow-lg`. |

### 2.2 What we deliberately do NOT take

- **The moon, lunar surface, craters, or any space/celestial imagery or texture.** (Anti-copy, §18.)
- Mission labels, coordinates, countdowns, or aerospace copy tone.
- Dark, cinematic black backgrounds as the default theme — Searvia is light-theme-only.
- Heavy film grain, vignettes, chromatic aberration, or photographic texture overlays.
- Its exact section order, hero composition, or navigation layout.
- Any glow blobs, neon bloom, or high-saturation gradients used there for atmosphere.
- Slow, blocking, or non-interruptible scroll hijacking. Our scroll enhances; it never traps.

---

## 3. Brand system — wordmark & mark

On-light usage only. The brand never ships on a dark or photographic background in v1.

### 3.1 Wordmark: "searvia"

| Attribute | Specification |
| --- | --- |
| Casing | **Always lowercase.** Never "Searvia", "SEARVIA", or "SearVia" in the wordmark. (Sentence-case "Searvia" is allowed in running prose only.) |
| Typeface | **General Sans** (Fontshare), Medium (500). Fallback / alternate: Inter Display Medium. A geometric-humanist grotesque with an open aperture — reads clean at small sizes. |
| Weight | 500 (Medium). Never Bold for the wordmark; never Light. |
| Tracking | `-0.01em` (−10 units) for optical tightening at display sizes; `0` at ≤16px. |
| Optical size | Enable optical sizing where the variable font supports it; otherwise use the display cut ≥28px and the text cut <28px. |
| Color | `--neutral-900` (#12161C) on light. Reversed/mono variants in §3.4. |
| Accent option | The dot of the letter "i" may be replaced by the scan-trace node (`--accent-500`) at sizes ≥24px only. Optional, never mandatory. |
| Minimum size | 16px cap-height on screen (≈20px font size); 12mm width in print. Below this, use the mark alone. |
| Clear space | Minimum clear space on all sides = cap-height of the wordmark (the height of the "s"). Nothing — text, rule, edge, image — intrudes. |

**Wordmark do / don't**

- Do keep it lowercase, near-black, on white or `--neutral-50`.
- Do lock tracking; do preserve clear space.
- Don't outline, emboss, add shadow, gradient-fill, or animate the letters.
- Don't stretch, condense, re-space, or recolor letters individually (except the optional "i"-node above).
- Don't place on busy imagery, on the accent color, or at an angle.

### 3.2 Abstract mark — the path "s"

The mark is a single **continuous directional rail** that turns twice to imply a lowercase "s" / a path, terminating in a **scan-trace node**. It reads as *a route with a live point on it*, not a letter.

**Construction grid**

- Draw inside a **24 × 24 unit** grid (the icon artboard), with a **2-unit** safe margin on all sides → live area 20 × 20.
- The rail is a single open **stroke**, not a filled glyph.
- **Stroke width: 3 units** at the 24-grid (i.e., 12.5% of artboard). This scales to `2.5px` stroke at 20px, `3px` at 24px, `4px` at 32px.
- **Corner treatment:** round line caps and round joins; corner radius on the two turns = 1.5× stroke width. No sharp corners anywhere.

**Geometry (draw-it-precisely)**

- Top counter-curve: an arc opening to the upper-left, spanning grid x[6→18], y[4→10], curving like the top of an "s".
- Diagonal spine: a gentle S-linking segment from (18,10) sweeping down-left through (12,12) to (6,14) — the "via" rail, kept slightly straighter than a true "s" so it reads as a route, not typography.
- Bottom counter-curve: an arc opening to the lower-right, spanning x[6→18], y[14→20].
- **Scan-trace node:** a filled dot of diameter 4 units centered at the *end* of the rail (bottom-right terminal, ≈ (18,18)), rendered in `--accent-500`. A faint concentric ring (1-unit stroke, `--accent-200`, 40% opacity) may sit around the node at sizes ≥32px to imply a radar ping. The node is the only accent-colored element in the mark.

```
  24-unit grid            legend:  ── rail (neutral-900, 3u stroke)
  0        12        24             ●  scan-trace node (accent-500)
0 · · · · · · · · · · · ·           ◌  optional ping ring (accent-200)
  · · ╭───────────╮ · · ·
6 · · │  top arc  ╰──╮ · ·
  · · ╰──╮ · · · · · │ · ·
12· · · ·╰───╮ · · ·╱ · · ·   ← diagonal "via" spine
  · · · · · · ╰──╮ ╱ · · · ·
18· · ╭────────╮ ●◌ · · · ·   ← terminal node
  · · │bottom arc╯ · · · · ·
24· · ╰ · · · · · · · · · · ·
```

**Size steps**

| Context | Box | Stroke | Node | Ping ring |
| --- | --- | --- | --- | --- |
| Favicon / 16px | 16×16 | 2px | 3px | omit |
| UI inline / 20px | 20×20 | 2.5px | 3.5px | omit |
| Standard / 24px | 24×24 | 3px | 4px | optional |
| App icon / 32–64px | scale | 4px+ | scale | show |
| Marketing / ≥96px | scale | scale (keep 12.5%) | scale | show, animatable |

**Variants**

- **Monochrome:** entire mark (rail + node) in `--neutral-900` for stamps, embossing simulation, single-color contexts, and favicons at ≤16px.
- **Accent:** rail `--neutral-900`, node `--accent-500` (default two-tone).
- **Reversed (light-on-dark, restricted):** rail `--neutral-0` (#FFF), node `--accent-300` — only for exceptional dark surfaces (e.g., an OG image); not a supported product theme.

**Favicon / app-icon reduction**

- ≤16px: drop the ping ring, thicken stroke to 2px minimum, keep the node as a solid 3px dot so the "live point" survives. Center on `--neutral-0`; app icon uses a `--radius-lg` rounded-square `--neutral-0` field with the mark at 62.5% of the tile.

**Incorrect usage (mark)**

- Don't fill the rail into a solid glyph or add a background chip behind it (except the app-icon tile).
- Don't rotate, skew, mirror, or "close" the path into a loop.
- Don't recolor the node anything but the accent (or neutral in mono).
- Don't add gradients, glow, drop shadows, or a second node.
- Don't let it become a magnifying glass, an eye, a lens, a brain, a chat bubble, or a moon/crescent. If the ping ring ever reads as an orbit or crater, remove it.

### 3.3 Anti-copy reinforcement

The mark is a **path with a live node**, never a lens, orb, planet, or synapse. No magnifying glass. No moon/crescent/space. No robot or brain. No gradient meshes or glow blobs. If a reduction starts to resemble any competitor mark or any forbidden motif (§18), revert to the plain monochrome rail.

### 3.4 Logo lockups (on-light only)

| Lockup | Composition | Spacing |
| --- | --- | --- |
| Wordmark solo | "searvia" | Default for text-dominant contexts (footer, legal). |
| Mark solo | path-"s" mark | Favicon, app icon, avatar, compact nav, loading state. |
| Horizontal lockup | mark + wordmark, left-to-right | Primary header lockup. Gap between mark and wordmark = **0.5× wordmark cap-height**. Vertically center the mark on the wordmark's cap-height (align optical centers, not bounding boxes). |
| Stacked lockup | mark above wordmark, centered | Splash / OG / narrow contexts only. Gap = 0.75× cap-height. |

- Clear space for any lockup = cap-height of the wordmark on all sides (as §3.1).
- Minimum horizontal-lockup width: 96px. Below that, use the mark solo.
- Never recolor, reorder, restack, or re-space a lockup. Never combine a lockup with a tagline inside the clear-space zone; the tagline sits outside it.

---

## 4. The visibility-path creative system

The **visibility path** is Searvia's signature system: a living route of directional rails and scan traces that begins at the URL input and travels through **evidence → rankings → citations → prioritized actions**. It is the same metaphor everywhere, tuned by context: cinematic in marketing, quiet and functional in product.

### 4.1 The five waypoints

```
   [1] URL INPUT ──────●──────── [2] EVIDENCE ──────●──────── [3] RANKINGS
   enter a domain      │         crawl + on-page      │        SERP + share
   "the origin"        │         checks, honest        │        of voice
                       │         state per item        │
                       ╰──── scan trace threads ───────╯
                                     │
                         [4] CITATIONS ──────●────── [5] ACTIONS
                         appears in AI answers?         prioritized,
                         (integration-honest)          defensible plan
```

- **[1] URL input** — the origin node; the path literally emanates from the input field.
- **[2] Evidence** — crawl results and on-page checks; each item carries an honest status (§5.1).
- **[3] Rankings** — keyword positions, visibility trend, share of voice vs. competitors.
- **[4] Citations** — whether the brand appears in AI-generated answers; integration-dependent, shown with an honest integration-required state when not connected — never faked.
- **[5] Actions** — the prioritized, evidence-linked task list the whole path leads to.

### 4.2 Geometry & tokens

| Token | Value | Use |
| --- | --- | --- |
| `--path-rail-width` | 2px (product) / 3px (marketing hero) | The rail stroke. |
| `--path-rail-color` | `--neutral-300` (inactive) / `--accent-500` (active/live segment) | Directional rail. |
| `--path-node-size` | 8px (product) / 12–16px (marketing) | Waypoint node diameter. |
| `--path-node-active` | `--accent-500` fill, `--neutral-0` 2px inner ring | Current / live waypoint. |
| `--path-node-done` | `--accent-600` fill, no ring | Completed waypoint. |
| `--path-node-idle` | `--neutral-0` fill, `--neutral-300` 2px ring | Not-yet-reached waypoint. |
| `--path-trace-color` | `--accent-400` at 24% opacity | The faint "scan trace" that animates along the rail. |
| `--path-trace-dash` | dasharray 2 6, round caps | Scan-trace texture (marketing only). |
| `--path-grid-opacity` | 4–6% | Background scan-grid layer (marketing only). |
| `--path-corner-radius` | 8px | Rail direction changes are always rounded. |

- Rails run orthogonally or on 45° diagonals only; every turn uses `--path-corner-radius`. No freehand curves except the wordmark-adjacent hero flourish.
- Nodes are circles; the *active* node may carry one concentric radar ring (`--accent-200`, 40%) — the only place a ping ring appears in product, and only on the single active waypoint.

### 4.3 Threading the path through the flow

- **URL input:** the rail originates at the right edge of the input; on submit, the trace animates outward toward Evidence (crawl-progress, §6).
- **Evidence → Rankings → Citations:** in product, the path degrades to a slim sticky **step rail** at the top of an audit or the left of a report — nodes reflect real completion state (idle/active/done) driven by data, never decorative.
- **Actions:** the terminal node is `--accent-600` filled; the actions list is visually "where the path lands."

### 4.4 Marketing vs. product usage

| | Marketing | Product |
| --- | --- | --- |
| Prominence | Hero-level, animated draw-on, oversized | Slim, functional, ≤2px rail |
| Scan grid | Yes, 4–6% opacity | No |
| Ping rings | On feature nodes | Only the single active waypoint |
| Trace animation | Looping scan traces allowed | Only during live crawl/scan; stops when done |
| Depth | Layered (framed viewport) | Flat; elevation via `--shadow-*` only |

**Rule:** the path must never obscure or compete with data. In product, if the path and a data element conflict for attention, the data wins and the path recedes to `--neutral-300`.

### 4.5 Reduced-motion behavior

When `prefers-reduced-motion: reduce`, the path is drawn **statically** in its final state: rails at full length, nodes in their correct idle/active/done colors, no trace animation, no draw-on, no looping. The active node may show a static ring but never pulses. The metaphor survives entirely without motion (see §6.6).

---

## 5. Design tokens (light theme)

Light theme is the only theme. All tokens below are the single source of truth — copy them verbatim. CSS custom properties are authored on `:root`; Tailwind mappings assume `theme.extend`.

### 5.1 Color

#### 5.1.1 Neutral base / surface ramp

Near-black text on white and soft-gray surfaces.

| Role | CSS var | Hex | Tailwind key | Usage |
| --- | --- | --- | --- | --- |
| Base white | `--neutral-0` | `#FFFFFF` | `neutral-0` | App background, cards |
| Off-white | `--neutral-25` | `#FBFCFD` | `neutral-25` | Subtle raised surface |
| Soft gray | `--neutral-50` | `#F6F8FA` | `neutral-50` | Page matte, section bg, framed viewport |
| Surface-2 | `--neutral-100` | `#EEF1F4` | `neutral-100` | Hover fills, table zebra |
| Border-subtle | `--neutral-200` | `#E2E7EC` | `neutral-200` | Default hairline borders |
| Border-strong | `--neutral-300` | `#CBD3DB` | `neutral-300` | Emphasis borders, inactive rail |
| Disabled/line | `--neutral-400` | `#9AA5B1` | `neutral-400` | Disabled text, chart gridlines |
| Muted text | `--neutral-500` | `#6B7683` | `neutral-500` | Secondary/caption text |
| Body-2 text | `--neutral-600` | `#4B5563` | `neutral-600` | Secondary body text |
| Strong text | `--neutral-700` | `#333B45` | `neutral-700` | Emphasis body |
| Heading | `--neutral-800` | `#1F2530` | `neutral-800` | Headings |
| Near-black text | `--neutral-900` | `#12161C` | `neutral-900` | Primary text, wordmark, rail |
| Ink | `--neutral-950` | `#0A0D12` | `neutral-950` | Max-contrast ink |

#### 5.1.2 Primary accent — electric indigo-blue (`--accent`)

The single primary accent. Marks the live path, the primary CTA, focus, and the "next step."

| Step | CSS var | Hex | Tailwind key | Usage |
| --- | --- | --- | --- | --- |
| 50 | `--accent-50` | `#EEF3FF` | `accent-50` | Tint backgrounds, selected rows |
| 100 | `--accent-100` | `#DCE6FF` | `accent-100` | Hover tint, chips |
| 200 | `--accent-200` | `#BACCFF` | `accent-200` | Ping ring, borders on tint |
| 300 | `--accent-300` | `#8FA8FF` | `accent-300` | Reversed node, dark-bg accent |
| 400 | `--accent-400` | `#5F7FFB` | `accent-400` | Scan trace, chart secondary |
| 500 | `--accent-500` | `#3B5BF0` | `accent-500` | **Base accent** — node, active rail, links, chart primary |
| 600 | `--accent-600` | `#2E47D6` | `accent-600` | **Primary button / text-on-white** (AA-safe) |
| 700 | `--accent-700` | `#2438AB` | `accent-700` | Button hover/pressed |
| 800 | `--accent-800` | `#1E2F86` | `accent-800` | Deep accent, focus on accent |
| 900 | `--accent-900` | `#1A2866` | `accent-900` | Darkest accent text |

> **Accent usage rule:** exactly one primary accent. `--accent-600` for accent *text/icons on white* (contrast-safe). `--accent-500` for the primary CTA fill (white text). Use accent sparingly — it means "live" or "do this next."

#### 5.1.3 Supporting cool hue — teal

Secondary, used for the "Opportunity"-adjacent data series and positive-direction charting. Never competes with the primary accent for CTAs.

| Step | CSS var | Hex | Tailwind key |
| --- | --- | --- | --- |
| 100 | `--teal-100` | `#CFF3EF` | `teal-100` |
| 300 | `--teal-300` | `#6FD8CE` | `teal-300` |
| 500 | `--teal-500` | `#0FB6A6` | `teal-500` |
| 600 | `--teal-600` | `#0B8E82` | `teal-600` (text-on-white AA-safe) |
| 700 | `--teal-700` | `#0A6E66` | `teal-700` |

#### 5.1.4 Semantic status colors

Status is always **icon + text + color** — never color alone. Each status has a foreground (text/icon on white), a base (fill/indicator), and a soft tint (badge background).

| Status | Icon (Phosphor-style) | FG (on white) CSS var / hex | Base CSS var / hex | Tint bg CSS var / hex | Tailwind key |
| --- | --- | --- | --- | --- | --- |
| **Critical** | `warning-octagon` (fill) | `--status-critical-fg` `#B42318` | `--status-critical` `#DC2626` | `--status-critical-bg` `#FEE4E2` | `critical` |
| **High** | `warning` (triangle) | `--status-high-fg` `#B54708` | `--status-high` `#EA580C` | `--status-high-bg` `#FEEAD6` | `high` |
| **Medium** | `warning-circle` | `--status-medium-fg` `#92600A` | `--status-medium` `#F59E0B` | `--status-medium-bg` `#FEF0CD` | `medium` |
| **Low** | `info` | `--status-low-fg` `#475467` | `--status-low` `#64748B` | `--status-low-bg` `#EEF1F4` | `low` |
| **Opportunity** | `sparkle` / `arrow-up-right` | `--status-opportunity-fg` `#6D28D9` | `--status-opportunity` `#7C3AED` | `--status-opportunity-bg` `#EDE7FE` | `opportunity` |
| **Passed** | `check-circle` | `--status-passed-fg` `#15803D` | `--status-passed` `#16A34A` | `--status-passed-bg` `#DCFCE7` | `passed` |
| **Not checked** | `circle-dashed` | `--status-notchecked-fg` `#6B7683` | `--status-notchecked` `#9AA5B1` | `--status-notchecked-bg` `#F6F8FA` | `notchecked` |
| **Manual review** | `eye` / `user-focus` | `--status-manual-fg` `#1D4ED8` | `--status-manual` `#2563EB` | `--status-manual-bg` `#DCE6FF` | `manual` |

> **Honesty note:** "Not checked" uses the muted gray + dashed-circle icon and is **never** rendered with the "Passed" green or check icon. "Manual review" (blue) and "Opportunity" (violet) are visually distinct from the primary accent (indigo-blue) so the CTA is never confused with a status.

#### 5.1.5 Key contrast ratios (WCAG 2.2)

Computed against the stated background; all body/label pairs meet AA.

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--neutral-900` #12161C on `--neutral-0` #FFF | ~16.1:1 | AAA |
| `--neutral-700` #333B45 on `--neutral-0` | ~10.7:1 | AAA |
| `--neutral-500` #6B7683 on `--neutral-0` | ~4.8:1 | AA (body/label) |
| `--neutral-500` on `--neutral-50` #F6F8FA | ~4.5:1 | AA (min) |
| `--accent-600` #2E47D6 on `--neutral-0` | ~7.4:1 | AAA (links/text) |
| White on `--accent-500` #3B5BF0 (primary CTA) | ~4.9:1 | AA |
| White on `--accent-600` #2E47D6 (CTA hover) | ~7.4:1 | AAA |
| `--status-critical-fg` #B42318 on white | ~6.0:1 | AA |
| `--status-passed-fg` #15803D on white | ~4.8:1 | AA |
| `--status-manual-fg` #1D4ED8 on white | ~7.0:1 | AAA |
| `--teal-600` #0B8E82 on white | ~4.6:1 | AA |

> Non-text UI (borders, icons, focus rings, chart strokes) targets ≥3:1 per WCAG 2.2 SC 1.4.11. Focus ring uses `--accent-600` at 2px + 2px offset (≥3:1 against white and adjacent fills).

### 5.2 Typography

#### 5.2.1 Font families

| Role | CSS var | Stack |
| --- | --- | --- |
| UI sans | `--font-sans` | `"Inter", "Inter var", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` |
| Display | `--font-display` | `"General Sans", "Inter Display", var(--font-sans)` |
| Mono | `--font-mono` | `"JetBrains Mono", "SF Mono", "Söhne Mono", ui-monospace, Menlo, Consolas, monospace` |

- **UI sans (Inter):** modern grotesque, excellent legibility, tabular-numerals enabled for data (`font-feature-settings: "tnum" 1, "cv05" 1`).
- **Display (General Sans):** geometric display face for oversized hero/section type only; never below `h1`.
- **Mono (JetBrains Mono):** URLs, code, API keys, competitor domains, and tabular technical values.

#### 5.2.2 Type scale

Sizes in px (rem in parentheses assume 16px root). Tracking in em.

| Token | Font | Size | Line-height | Weight | Tracking | Usage |
| --- | --- | --- | --- | --- | --- | --- |
| `display` | display | 72 (4.5rem) | 76px / 1.06 | 600 | −0.02em | Marketing hero only (clamps to 40px mobile) |
| `h1` | display/sans | 48 (3rem) | 52px / 1.08 | 600 | −0.02em | Page title / hero secondary |
| `h2` | sans | 36 (2.25rem) | 40px / 1.11 | 600 | −0.015em | Section opener |
| `h3` | sans | 28 (1.75rem) | 34px / 1.21 | 600 | −0.01em | Card/section title |
| `h4` | sans | 22 (1.375rem) | 28px / 1.27 | 600 | −0.005em | Subsection, drawer title |
| `h5` | sans | 18 (1.125rem) | 24px / 1.33 | 600 | 0 | Table group, widget title |
| `h6` | sans | 16 (1rem) | 22px / 1.375 | 600 | 0 | Dense label heading |
| `body-lg` | sans | 18 (1.125rem) | 28px / 1.56 | 400 | 0 | Lead paragraphs, marketing body |
| `body` | sans | 16 (1rem) | 24px / 1.5 | 400 | 0 | Default body / UI text |
| `body-sm` | sans | 14 (0.875rem) | 20px / 1.43 | 400 | 0 | Dense UI, table cells |
| `caption` | sans | 13 (0.8125rem) | 18px / 1.38 | 400 | 0 | Captions, "Demo data" labels, timestamps |
| `overline` | sans | 12 (0.75rem) | 16px / 1.33 | 600 | +0.08em | Uppercase eyebrows, status pills, section kickers |

- Headings use `--neutral-800`/`--neutral-900`; body uses `--neutral-700`/`--neutral-900`; secondary uses `--neutral-500`.
- Max readable measure: 68–72ch for `body-lg`, 75ch for `body`.
- Tabular numerals mandatory in all data tables, metrics, and charts.
- **"Demo data" caption:** `caption` size, `--neutral-500`, prefixed with the `info`/`flask` icon; required wherever example figures appear (§18).

### 5.3 Spacing scale (4px base)

| Token | Value | Token | Value |
| --- | --- | --- | --- |
| `--space-0` | 0 | `--space-6` | 24px |
| `--space-0-5` | 2px | `--space-8` | 32px |
| `--space-1` | 4px | `--space-10` | 40px |
| `--space-2` | 8px | `--space-12` | 48px |
| `--space-3` | 12px | `--space-16` | 64px |
| `--space-4` | 16px | `--space-20` | 80px |
| `--space-5` | 20px | `--space-24` | 96px |
|  |  | `--space-32` | 128px |

- Component internal padding defaults: buttons `--space-3`/`--space-4`; cards `--space-6`; table cells `--space-3` vertical / `--space-4` horizontal.
- Section vertical rhythm: mobile `--space-16`, tablet `--space-20`, desktop `--space-24`+ .

### 5.4 Radii

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-xs` | 4px | Chips, tags, checkboxes |
| `--radius-sm` | 6px | Inputs, buttons (dense) |
| `--radius-md` | 8px | Buttons, menus, small cards |
| `--radius-lg` | 12px | Cards, panels, app-icon tile |
| `--radius-xl` | 16px | Modals, large surfaces |
| `--radius-2xl` | 24px | Framed viewport, hero cards |
| `--radius-full` | 9999px | Pills, avatars, nodes |

### 5.5 Border widths & colors

| Token | Value |
| --- | --- |
| `--border-hairline` | 1px |
| `--border-thick` | 2px |
| `--border-color` | `--neutral-200` (#E2E7EC) default |
| `--border-color-strong` | `--neutral-300` (#CBD3DB) |
| `--border-color-subtle` | `--neutral-100` (#EEF1F4) |
| `--border-color-accent` | `--accent-500` (focus/active) |

### 5.6 Shadow / elevation ramp (subtle)

Deliberately restrained; no colored, glowing, or diffuse-bloom shadows.

| Token | Value | Usage |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 2px rgba(16,22,28,0.05)` | Hairline lift, inputs |
| `--shadow-sm` | `0 1px 3px rgba(16,22,28,0.08), 0 1px 2px rgba(16,22,28,0.04)` | Cards at rest |
| `--shadow-md` | `0 4px 12px rgba(16,22,28,0.08)` | Dropdowns, popovers |
| `--shadow-lg` | `0 12px 28px rgba(16,22,28,0.10)` | Modals, drawers (product max) |
| `--shadow-xl` | `0 24px 48px rgba(16,22,28,0.12)` | Marketing hero cards only |
| `--shadow-focus` | `0 0 0 2px #FFFFFF, 0 0 0 4px var(--accent-600)` | Keyboard focus ring |

### 5.7 Z-index layers

| Token | Value | Layer |
| --- | --- | --- |
| `--z-base` | 0 | Page content |
| `--z-raised` | 10 | Sticky rails, path progress |
| `--z-sticky` | 100 | Sticky headers, table headers |
| `--z-dropdown` | 1000 | Menus, selects, comboboxes |
| `--z-overlay` | 1100 | Modal/drawer scrim |
| `--z-modal` | 1200 | Modal / drawer |
| `--z-popover` | 1300 | Popovers, detail cards |
| `--z-toast` | 1400 | Toasts / notifications |
| `--z-tooltip` | 1500 | Tooltips (topmost) |

### 5.8 Breakpoints

Three required tiers, mapped to Tailwind-aligned edges.

| Tier | Range | Tailwind edge | CSS var |
| --- | --- | --- | --- |
| Mobile | < 768px | (base) | `--bp-mobile: 0` |
| Tablet | 768–1279px | `md: 768` / `lg: 1024` | `--bp-tablet: 768px` |
| Desktop | ≥ 1280px | `xl: 1280` / `2xl: 1536` | `--bp-desktop: 1280px` |

Additional Tailwind stops available for fine control: `sm: 640`, `md: 768`, `lg: 1024`, `xl: 1280`, `2xl: 1536`.

### 5.9 Container widths

| Token | Max width | Usage |
| --- | --- | --- |
| `--container-sm` | 640px | Focused forms, auth |
| `--container-md` | 768px | Article / docs measure |
| `--container-lg` | 1024px | Standard app content |
| `--container-xl` | 1200px | Marketing framed viewport, wide reports |
| `--container-2xl` | 1320px | Full dashboards, data tables |

- Product app shell content max-width: `--container-2xl` (1320px), centered, with responsive side padding (§5.10 margins).

### 5.10 Grid (columns / gutters / margins)

| Tier | Columns | Gutter | Outer margin |
| --- | --- | --- | --- |
| Mobile (<768) | 4 | 16px | 16px |
| Tablet (768–1279) | 8 | 20px | 32px |
| Desktop (≥1280) | 12 | 24px | auto (center to container) with min 40px, hero 80px |

- Product dashboards use the 12-col desktop grid; a common split is 8-col main + 4-col detail/side rail.
- Marketing uses the same 12-col grid inside `--container-xl`, with the framed-viewport matte extending full-bleed behind it.

---

## 6. Motion system

Motion clarifies causality (something loaded, moved, or completed) and expresses the visibility path. It is never decorative for its own sake and always has a reduced-motion equivalent.

### 6.1 Duration tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--dur-instant` | 0ms | State swaps that must not animate |
| `--dur-fast` | 120ms | Hover, small color/opacity changes |
| `--dur-base` | 200ms | Buttons, inputs, tooltips, most UI |
| `--dur-moderate` | 320ms | Dropdowns, popovers, tab/content swap |
| `--dur-slow` | 480ms | Modals, drawers, scroll reveals |
| `--dur-deliberate` | 720ms | Section entrance, staged reveals |
| `--dur-path` | 1200ms | Visibility-path draw-on / crawl trace |

### 6.2 Easing tokens

| Token | Cubic-bezier | Usage |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default in/out for UI |
| `--ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Enters (elements arriving), reveals |
| `--ease-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Exits (elements leaving) |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1.0)` | Hero / path emphasis, larger moves |
| `--ease-linear` | `linear` | Progress bars, crawl progress, shimmer |

### 6.3 Signature motions

| Motion | Spec | Reduced-motion fallback |
| --- | --- | --- |
| **Scroll reveal** | opacity 0→1 + translateY 16px→0, `--dur-slow`, `--ease-decelerate`, stagger ≤80ms, triggers once at ~15% in-view | Content is fully visible immediately; no translate, no fade, no stagger. |
| **Visibility-path draw-on** | SVG `stroke-dashoffset` animates the rail to full length over `--dur-path`, `--ease-emphasized`; nodes pop (scale 0.6→1, `--dur-base`) as the trace reaches each | Path renders complete and static in final state; nodes at final size; no draw, no pop (see §4.5). |
| **Hover** | color/border/shadow shift over `--dur-fast`, `--ease-standard`; cards lift `--shadow-sm`→`--shadow-md`, translateY −1px | Color/border change only (instant or `--dur-fast`); no lift/translate. |
| **Press** | scale 0.98, `--dur-fast`, `--ease-standard` | Background-color change only; no scale. |
| **Skeleton shimmer** | linear-gradient sweep left→right over 1200ms, `--ease-linear`, loop; `--neutral-100`→`--neutral-50`→`--neutral-100` | Static `--neutral-100` block with the `overline` label "Loading…"; no sweep. |
| **Crawl-progress** | determinate bar fills left→right + a single scan-trace dot travels the visibility rail from URL→Evidence, `--ease-linear`; percentage counts up | Determinate bar fills without the traveling dot; percentage updates in steps; no continuous animation. |

### 6.4 Interaction feedback rules

- All interactive elements show a `--dur-fast` visual response to hover and a clear `--shadow-focus` ring on keyboard focus (never removed).
- Toasts enter with `--dur-moderate` `--ease-decelerate` (slide+fade) and are dismissible; auto-dismiss ≥6s and pausable on hover/focus.
- Loading states prefer determinate progress (crawl-progress) over indeterminate spinners wherever a real percentage exists — reinforcing honesty.

### 6.5 Choreography

- Enter with `--ease-decelerate`, exit with `--ease-accelerate`, move/settle with `--ease-standard`.
- Stagger related items ≤80ms; never stagger more than ~6 items (batch the rest).
- Larger the element/travel, longer the duration — pair `--dur-slow`/`--dur-deliberate` with hero and section motion only.

### 6.6 Reduced-motion rule

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

- Under reduced motion, every signature motion falls back to its static/opacity-only equivalent in §6.3. No parallax, no looping traces, no shimmer sweep, no draw-on, no scale/lift.
- Essential meaning (progress %, active waypoint, loaded state, status) must be fully conveyed **without** motion in every case. Motion is always additive, never the sole carrier of information.
