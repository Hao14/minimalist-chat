# Searvia — Design Source of Truth

> **searvia** (SEER-vee-uh) · "Search visibility, made clear."
> Headline: **See what is limiting your search visibility.** · Action line: **Audit. Rank. Get cited.**

This is the single implementation-ready specification for Searvia: a premium, minimal, light-theme product that audits websites, tracks rankings, analyzes competitors, and shows a brand's presence in search engines and AI answers. It defines tokens, motif, wordmark, components, every screen, all states, accessibility, and the engineering file map. It is a design specification, not application code; fenced token/config/tree/interface blocks are spec artifacts.

**Reading rules for implementers**
- Values here are decisions, not suggestions. Do not substitute hexes, families, or copy without design sign-off.
- Every deterministic example in the product and marketing surfaces carries a visible **Demo data** badge (see §6).
- Light theme only. Native scrolling only. Semantic HTML. WCAG 2.2 AA. Respect `prefers-reduced-motion`.

---

## Contents

1. [Positioning and Product](#1-positioning-and-product)
2. [Design Principles](#2-design-principles)
3. [Art Direction and the Visibility Path Motif](#3-art-direction-and-the-visibility-path-motif)
4. [Design Tokens](#4-design-tokens)
5. [Wordmark and Mark](#5-wordmark-and-mark)
6. [Voice Tone and Demo Data](#6-voice-tone-and-demo-data)
7. [Fidelity and Anti Copy Gates](#7-fidelity-and-anti-copy-gates)
8. [Above the Fold Copy Lock](#8-above-the-fold-copy-lock)
9. [Iconography and Data Visualization](#9-iconography-and-data-visualization)
10. [Component Library](#10-component-library)
11. [Homepage](#11-homepage)
12. [Authentication and Onboarding](#12-authentication-and-onboarding)
13. [Product Shell and Overview](#13-product-shell-and-overview)
14. [Site Audit Live Crawl and Crawl Management](#14-site-audit-live-crawl-and-crawl-management)
15. [Issues and Crawled Pages](#15-issues-and-crawled-pages)
16. [Later Modules Integration States and Global States Catalog](#16-later-modules-integration-states-and-global-states-catalog)
17. [Accessibility and Responsive Rules](#17-accessibility-and-responsive-rules)
18. [Engineering File Map](#18-engineering-file-map)

---

## 1. Positioning and Product

**Name.** searvia — always lowercase in the wordmark. Pronounced *SEER-vee-uh*. It compresses "search" + "via" (the path/way): the route by which a brand becomes visible. Meaning line: "Search visibility, made clear."

**Promise.** *See what is limiting your search visibility.* Searvia turns an opaque question ("why aren't we found?") into ranked, evidenced actions.

**Action line.** *Audit. Rank. Get cited.* — three verbs, three jobs, in order of the visibility path.

**One-line description.** Searvia crawls your site, ranks the fixes by impact, and shows where you appear across search engines and AI answers.

**Who it is for.** In-house SEO and growth teams, agencies, and founders who need evidence and priorities, not another dashboard to interpret.

**The four jobs and build maturity.** Searvia ships Site Audit first and fully; the remaining modules are designed here but gated behind honest *Integration required* states (§16) until a data source is connected.

| # | Job | Verb | Status in this spec | Requires |
|---|-----|------|---------------------|----------|
| 1 | **Site Audit** — crawl the site, surface issues, rank fixes by impact | Audit | Fully designed, live | A crawl (built in) |
| 2 | **Rankings** — track keyword positions over time | Rank | Designed; integration-required | Search Console or a rank-data source |
| 3 | **Competitors** — compare share of visibility | — | Designed; integration-required | A competitor set + visibility data |
| 4 | **Brand presence in AI answers** — where you are cited | Get cited | Designed; integration-required | An AI-answer monitoring source/API |

The through-line across all four is the **living visibility path**: *URL → crawl evidence → rankings → citations → prioritized actions* (§3).

---

## 2. Design Principles

| Principle | Rule | Application |
|-----------|------|-------------|
| **The path is the product** | Every surface sits somewhere on URL→crawl→rankings→citations→actions. | Nav, progress, and the mark all trace the same path; users always know where they are on it. |
| **Evidence over adjectives** | Never assert a problem without showing the artifact. | Issues link to the offending tag, the page, and the crawl that found it. |
| **Instrument, not dashboard** | Read like a measuring device: quiet, precise, calibrated. | Edge-ticks, monospaced numerals, restrained accents; no decorative widgets. |
| **Quiet by default, loud only for severity** | Color and weight are earned by meaning. | Neutral surfaces; accent/severity color only where it changes a decision. |
| **Sparse → dense → focused** | Airy intro, dense evidence, focused action — in that rhythm. | Homepage and every screen open light, thicken with data, resolve to a next step. |
| **Honest states** | Never fake data or readiness. | Locked modules say what they need; every fixture is badged **Demo data**. |
| **Progress is legible** | Long work is staged and narrated, never a spinner-in-the-dark. | The crawl runs as a visible, counted, seven-stage timeline (§14). |
| **Keyboard-first, motion-optional** | Anything the pointer can do, the keyboard can too; motion is decoration. | Full keyboard model (§17); `prefers-reduced-motion` removes the scan trace, keeps the meaning. |

---

## 3. Art Direction and the Visibility Path Motif

### 3.1 Thesis and reference reinterpretation
Searvia looks like a **precision instrument for visibility** — cool-white field, near-black type, hairline structure, restrained indigo/electric-blue/teal used only for meaning. We reinterpret the referenced site (21hrs.space) through **five abstractions only** and nothing else:

1. **Layered depth** — quiet z-layers (field → rails → content → overlays), never skeuomorphic scenery.
2. **Oversized structural typography** — large numerals and short labels act as layout structure, not ornament.
3. **Persistent instrument-like edge ticks** — fine ruler ticks on section and card edges give a measured, calibrated feel.
4. **Sparse → dense → focused rhythm** — pacing doctrine for every long surface.
5. **Timeline cues** — progress and history read as a left-to-right timeline.

Explicitly **not** borrowed: no moon/space/stars/craters/mission/launch/orbit copy or imagery, no exact frame or layout clone, no scroll hijacking, no audio UI, no magnifying-glass search icon, no robot/brain AI imagery, no heavy gradients/glow, no bento-tile template, no Semrush look-alike.

### 3.2 The living visibility path
The path is a horizontal spine with **five nodes**: `url → crawl → rankings → citations → actions`. It appears at three scales: in the **mark**, as a **section motif** on marketing, and as **live progress** in the crawl.

**Paired rails.** Two hairline rails, `1px` each, `--color-border` (`#D7DCE2`), spaced `6px` apart. On an active segment the inner rail switches to `--accent-data` (`#0A6FDB`) at `1.5px`. Rails turn corners with a `12px` radius; they never form a closed box (that would read as bento).

**Scan trace.** A `48px` highlight segment travels along the active rail — a soft left-to-right gradient of `--accent-data` at `0.9` opacity, `1400ms` loop, `--ease-scan`. It maps 1:1 to real progress position (0–100%). Under reduced motion it becomes a **static filled segment** whose length equals percent complete.

**Nodes.** Each node is an `8px` ring with a `3px` center. States: *pending* = hollow `--color-border`; *active* = filled `--accent-action` with the scan trace entering it; *complete* = filled with a `check` tick in `--accent-teal`. Node labels use `overline` type.

| Path node | Meaning | Where it recurs |
|-----------|---------|-----------------|
| `url` | the domain entered | hero input, onboarding step 1, crawl stage 1 |
| `crawl` | evidence gathered | Site Audit, live crawl |
| `rankings` | positions over time | Rankings module |
| `citations` | presence in answers | AI Presence module |
| `actions` | ranked fixes | Overview top-actions, Issues |

### 3.3 Layered depth (z-layers)
| Layer | Contents | Elevation |
|-------|----------|-----------|
| L0 field | app/marketing background `--surface-app` | none |
| L1 structure | rails, edge-ticks, gridlines | none (hairlines) |
| L2 content | cards, tables, panels | `--elev-1`/`--elev-2` |
| L3 overlays | drawers, dialogs, menus, toasts | `--elev-3`/`--elev-4` |

### 3.4 Oversized structural typography
Use the **display** tier (§4.2) for one anchoring element per section: a metric (`98`), a stage label (`crawling`), or a two-word statement. It is set in `--color-ink`, tight tracking, and aligned to the grid so it reads as structure. Never more than one display element competing per viewport.

### 3.5 Edge-tick system
Fine ticks: length `6px`, gap `12px`, weight `1px`. **Decorative** ticks use `--color-border`; **meaningful** ticks (chart axes, the crawl timeline, comparison ranges) use `--color-border-strong` and are dimensioned. Cards carry **L-shaped corner ticks** (`8px` arms) at top-left and bottom-right only, never a full frame. Section dividers place a tick row along the top edge.

### 3.6 Rhythm doctrine
Every long surface follows **sparse → dense → focused**: open with air and one oversized anchor; thicken into evidence (tables, charts, the path); resolve to a single focused action (a CTA, a ranked fix, a "run crawl"). The homepage (§11) is the canonical example.

### 3.7 Anti-copy alternatives
| Forbidden | Approved Searvia alternative |
|-----------|------------------------------|
| Magnifying-glass search icon | rail + scan-node glyph (`icon.search`) |
| Robot / brain for AI | quotation/citation bracket glyph (`icon.aiAnswer`) |
| Space/moon/mission scenery & copy | the visibility path + instrument edge-ticks |
| Heavy gradients / glow | flat fills; at most a `0.9`→`0` single-hue scan gradient |
| Bento tile grid | asymmetric 12-col layout with hairline rails, never closed boxes |
| Semrush toolbar/orange | cool-white field, indigo/blue/teal accents only |
| Scroll hijack sequences | native scroll; motion is entrance-only and reduced-motion-safe |

---

## 4. Design Tokens

### 4.1 Color

**Neutral ramp (cool-gray).**

| Token | Hex | Role |
|-------|-----|------|
| `--white` | `#FFFFFF` | true white surfaces, cards |
| `--gray-25` | `#FBFCFD` | app background |
| `--gray-50` | `#F6F8FA` | sunken/hover surface |
| `--gray-100` | `#EEF1F4` | subtle fill, table zebra |
| `--gray-150` | `#E4E8EC` | hairline border |
| `--gray-200` | `#D7DCE2` | default border |
| `--gray-300` | `#C2C9D1` | strong border, disabled text on fill |
| `--gray-400` | `#9AA3AD` | placeholder, icon-muted |
| `--gray-500` | `#6B7480` | text-muted (AA on white 4.6:1) |
| `--gray-600` | `#505A66` | text-secondary (7.0:1) |
| `--gray-700` | `#3A424C` | headings-secondary |
| `--gray-900` | `#12161B` | near-black |
| `--ink` | `#0B0E12` | text-primary (17.8:1) |

**Accent ramps** (used only for meaning).

| Token | Hex | Role / contrast |
|-------|-----|-----------------|
| `--indigo-50` | `#EEF0FF` | tint bg |
| `--indigo-100` | `#E0E4FF` | selected bg |
| `--indigo-500` | `#5661E3` | focus ring, hover accent |
| `--indigo-600` | `#4650D6` | **accent-action** (primary buttons; white text 5.9:1 AA) |
| `--indigo-700` | `#3A43B8` | action hover/active |
| `--blue-50` | `#EAF3FF` | data tint bg |
| `--blue-500` | `#1C8CFF` | data highlight, scan trace top |
| `--blue-600` | `#0A6FDB` | **accent-data** (links, data; on white 4.7:1 AA) |
| `--teal-50` | `#E5F6F2` | citation tint bg |
| `--teal-500` | `#12A594` | positive fills, citation dots |
| `--teal-700` | `#0B7568` | **accent-citation** text (on white 4.6:1 AA) |

**Semantic status** (restrained for light theme; always paired with icon + label, never color-only).

| Token | Hex | Use |
|-------|-----|-----|
| `--success` | `#0B7568` | resolved, connected, clean |
| `--warning` | `#B7791F` | degraded, expiring |
| `--danger` | `#C62B2B` | failed, critical |
| `--info` | `#0A6FDB` | neutral notices |

**Severity scale.**

| Token | Hex | Label |
|-------|-----|-------|
| `--sev-critical` | `#C62B2B` | Critical |
| `--sev-high` | `#D2691E` | High |
| `--sev-medium` | `#B7791F` | Medium |
| `--sev-low` | `#4650D6` | Low |
| `--sev-notice` | `#6B7480` | Notice |

**Semantic role tokens.**
`--surface-app:var(--gray-25)` · `--surface:var(--white)` · `--surface-raised:var(--white)` · `--surface-sunken:var(--gray-50)` · `--border-hairline:var(--gray-150)` · `--color-border:var(--gray-200)` · `--color-border-strong:var(--gray-300)` · `--text-primary:var(--ink)` · `--text-secondary:var(--gray-600)` · `--text-muted:var(--gray-500)` · `--text-inverse:var(--white)` · `--accent-action:var(--indigo-600)` · `--accent-data:var(--blue-600)` · `--accent-citation:var(--teal-700)` · `--focus-ring:var(--indigo-500)`.

### 4.2 Typography

**Families.** UI + display: **Geist Sans** (self-hosted, variable); evidence/URLs/numerals: **Geist Mono**. Fallbacks: `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` and `ui-monospace, "SFMono-Regular", "Cascadia Code", Consolas, monospace`. Numerals use `font-variant-numeric: tabular-nums` everywhere metrics align.

| Token | Size | Line-height | Weight | Tracking | Use |
|-------|------|-------------|--------|----------|-----|
| `display-xl` | 72px / 4.5rem | 1.0 | 600 | −0.03em | hero structural figure/word |
| `display-lg` | 56px / 3.5rem | 1.02 | 600 | −0.025em | section anchors |
| `display-md` | 44px / 2.75rem | 1.05 | 600 | −0.02em | oversized metrics |
| `h1` | 32px / 2rem | 1.15 | 600 | −0.015em | page title |
| `h2` | 24px / 1.5rem | 1.2 | 600 | −0.01em | section |
| `h3` | 20px / 1.25rem | 1.3 | 600 | −0.005em | card title |
| `h4` | 17px / 1.0625rem | 1.35 | 600 | 0 | sub-card |
| `body-lg` | 18px / 1.125rem | 1.6 | 400 | 0 | marketing body |
| `body` | 16px / 1rem | 1.55 | 400 | 0 | default |
| `body-sm` | 14px / 0.875rem | 1.5 | 400 | 0 | dense UI, table cells |
| `caption` | 13px / 0.8125rem | 1.45 | 450 | 0 | meta, timestamps |
| `overline` | 11px / 0.6875rem | 1.2 | 600 | 0.12em | node/section labels, UPPERCASE |
| `mono` | 14px / 0.875rem | 1.5 | 450 | 0 | URLs, tags, numerals, evidence |

### 4.3 Spacing, radii, borders
**Spacing (4px base):** `space-0:0` `space-1:4` `space-2:8` `space-3:12` `space-4:16` `space-5:20` `space-6:24` `space-8:32` `space-10:40` `space-12:48` `space-16:64` `space-20:80` `space-24:96` `space-32:128`.
**Radii:** `radius-xs:4` `radius-sm:6` `radius-md:8` `radius-lg:12` `radius-xl:16` `radius-2xl:24` `radius-full:9999`. Inputs `sm`, cards `lg`, pills `full`, dialogs `xl`.
**Borders:** hairline `1px --border-hairline`; default `1px --color-border`; strong `1.5px --color-border-strong`.

### 4.4 Elevation (soft, light-theme)
| Token | Value | Use |
|-------|-------|-----|
| `--elev-0` | none | flat, hairline-bounded |
| `--elev-1` | `0 1px 2px rgba(16,22,27,.05)` | cards, inputs |
| `--elev-2` | `0 2px 6px rgba(16,22,27,.06), 0 1px 2px rgba(16,22,27,.04)` | raised cards, popovers |
| `--elev-3` | `0 8px 24px rgba(16,22,27,.08)` | drawers |
| `--elev-4` | `0 16px 48px rgba(16,22,27,.12)` | dialogs, command palette |
| `--ring-focus` | `0 0 0 2px var(--white), 0 0 0 4px var(--focus-ring)` | focus-visible |

### 4.5 Motion
| Token | Value | Use |
|-------|-------|-----|
| `--dur-fast` | 120ms | hover, small toggles |
| `--dur-base` | 200ms | menus, tabs, drawers open |
| `--dur-slow` | 320ms | dialogs, page transitions |
| `--dur-scan` | 1400ms | scan-trace loop |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | entrances |
| `--ease-inout` | `cubic-bezier(.65,0,.35,1)` | move/resize |
| `--ease-scan` | `cubic-bezier(.4,0,.2,1)` | scan trace |

`@media (prefers-reduced-motion: reduce)`: all durations → `1ms`; scan trace static; chart draw-on and skeleton shimmer disabled; counters still update via `aria-live`.

### 4.6 Z-index, breakpoints, grid
**Z-index:** `z-base:0` `z-sticky:100` `z-dropdown:1000` `z-drawer:1100` `z-cmdk:1250` `z-dialog:1200` `z-toast:1300` `z-tooltip:1400`.
**Breakpoints:** `sm:640` `md:768` `lg:1024` `xl:1280` `2xl:1536`.
**Containers:** marketing max `1200px`; app content max `1440px` fluid.
**Grid:** 12 columns. Gutters `24px` (≥lg), `16px` (md), `16px` (sm). Outer margins `24px` (≥lg), `16px` (<lg). Edge-ticks align to column lines.
**Edge-tick tokens:** `--tick-len:6px` `--tick-gap:12px` `--tick-weight:1px` `--tick-corner:8px`.
**Path tokens:** `--rail-weight:1px` `--rail-active-weight:1.5px` `--rail-gap:6px` `--scan-len:48px` `--node-size:8px`.

### 4.7 Root custom properties (excerpt)
```css
:root{
  /* neutral */
  --white:#FFFFFF; --gray-25:#FBFCFD; --gray-50:#F6F8FA; --gray-100:#EEF1F4;
  --gray-150:#E4E8EC; --gray-200:#D7DCE2; --gray-300:#C2C9D1; --gray-400:#9AA3AD;
  --gray-500:#6B7480; --gray-600:#505A66; --gray-700:#3A424C; --gray-900:#12161B; --ink:#0B0E12;
  /* accents */
  --indigo-50:#EEF0FF; --indigo-100:#E0E4FF; --indigo-500:#5661E3; --indigo-600:#4650D6; --indigo-700:#3A43B8;
  --blue-50:#EAF3FF; --blue-500:#1C8CFF; --blue-600:#0A6FDB;
  --teal-50:#E5F6F2; --teal-500:#12A594; --teal-700:#0B7568;
  /* status + severity */
  --success:#0B7568; --warning:#B7791F; --danger:#C62B2B; --info:#0A6FDB;
  --sev-critical:#C62B2B; --sev-high:#D2691E; --sev-medium:#B7791F; --sev-low:#4650D6; --sev-notice:#6B7480;
  /* roles */
  --surface-app:var(--gray-25); --surface:var(--white); --surface-sunken:var(--gray-50);
  --color-border:var(--gray-200); --border-hairline:var(--gray-150); --color-border-strong:var(--gray-300);
  --text-primary:var(--ink); --text-secondary:var(--gray-600); --text-muted:var(--gray-500); --text-inverse:var(--white);
  --accent-action:var(--indigo-600); --accent-data:var(--blue-600); --accent-citation:var(--teal-700); --focus-ring:var(--indigo-500);
  /* elevation, motion, path */
  --elev-1:0 1px 2px rgba(16,22,27,.05);
  --elev-2:0 2px 6px rgba(16,22,27,.06),0 1px 2px rgba(16,22,27,.04);
  --elev-3:0 8px 24px rgba(16,22,27,.08); --elev-4:0 16px 48px rgba(16,22,27,.12);
  --ring-focus:0 0 0 2px var(--white),0 0 0 4px var(--focus-ring);
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms; --dur-scan:1400ms;
  --ease-out:cubic-bezier(.16,1,.3,1); --ease-inout:cubic-bezier(.65,0,.35,1); --ease-scan:cubic-bezier(.4,0,.2,1);
  --rail-weight:1px; --rail-active-weight:1.5px; --rail-gap:6px; --scan-len:48px; --node-size:8px;
  --tick-len:6px; --tick-gap:12px; --tick-weight:1px; --tick-corner:8px;
}
```

---

## 5. Wordmark and Mark

### 5.1 Wordmark
- **Text:** `searvia`, always lowercase. Geist Sans, weight **600**, tracking **−0.02em**, optical baseline. Color `--ink`.
- **Single permitted accent:** the dot of the **i** is replaced by the **scan node** — a `0.62em` square with `2px` radius in `--accent-data`. This is the only recolor allowed.
- **Clear space:** the x-height of `s` on all four sides.
- **Minimum size:** 84px wide (nav), 64px absolute floor.
- **Variants:** (a) ink on light (default); (b) all-ink monochrome (print, watermarks); (c) reversed `--white` for the rare dark photographic panel (auth motif uses light, so reversed is exceptional).
- **Misuse:** no full-color fills, no outline, no stretch/condense, no capitalization, no gradient, no drop shadow, no reordering the accent to another letter.

### 5.2 Mark
An abstract glyph of the visibility path: **paired hairline rails** sweep forward and resolve into an implied lowercase **s**, with a **scan node** at the leading head.

- **Grid:** 24×24. Rails `2px`, `--ink`; rail gap `2px`. Leading **node** `4px` square, `--accent-data`. Safe area `4px` inside the 24 grid.
- **Construction:** two parallel strokes enter lower-left, curve through a shallow S, exit upper-right; the node caps the exit as "the scan reaching the newest evidence." No closed counters, no magnifying glass, no brain.
- **Sizes / favicon:**
  - 16px: single rail + node (paired rails collapse to one for legibility).
  - 32px: paired rails + node.
  - 180px (apple-touch) / 512px (maskable): mark centered on `--white`, optional corner edge-ticks, no background gradient, safe area = 12.5% padding.
- **Lockup:** mark + wordmark share a baseline; gap = mark height × 0.5.

---

## 6. Voice Tone and Demo Data

### 6.1 Voice and tone
Clear, precise, non-hype — a calm instrument. **Sentence case** everywhere (buttons, headings, nav). **No exclamation marks.** Lead with the verb for actions ("Run crawl", "Connect Search Console"). Name the evidence, not the vibe ("14 pages return 404", not "some issues found"). Avoid "just", "simply", "powerful", "revolutionary". Second person for guidance ("Add your site").

**Microcopy patterns.**
- Buttons: verb + object, ≤3 words — "Run crawl", "Compare crawls", "Mark fixed".
- Empty first-run: state the value + the one action — "No crawl yet. Run your first audit to see what's limiting visibility." + `Run first crawl`.
- Errors: what happened + why + what to do — "Crawl blocked by robots.txt. Searvia respects it. Allow the Searvia agent or upload a sitemap."
- Success: confirm + next step — "Crawl complete. 128 pages, 23 issues found. Review top actions."

**Formatting.** Numbers use tabular numerals and thousands separators (`1,284`). Dates: `15 Jul 2026` / relative under 7 days ("2 days ago"). Durations: `4m 12s`. URLs and tags in `mono`. Percent deltas signed with direction: `+6` / `−3`.

### 6.2 Demo data convention
Any value not produced by the viewer's own live data is **Demo data** and must be visibly labeled.

- **Badge:** pill, `caption` size, text `Demo data`, `--text-secondary` on `--gray-100` fill, `radius-full`, `2px 8px` padding, a `4px` `--info` leading dot. Component: `<DemoBadge/>`.
- **Placement:** top-right of any fixture card/chart/table/stat tile; inline suffix on example URLs/domains; a single caption under any marketing screenshot-in-words. On full demo previews (e.g., locked-module preview, `See a demo report`) a persistent **"Demo data" ribbon** sits in the surface's top-right and a footnote reads "Every figure on this screen is Demo data."
- **Example fixtures use reserved names:** domains `demo-domain.example`, `rival-demo.example`; brand "Northwind Demo"; never a real customer's data.
- **Never** style Demo data to look live: it always carries the badge; it is never used in totals presented as the user's own.

---

## 7. Fidelity and Anti Copy Gates

### 7.1 Fidelity gate (all must be true to ship)
1. Colors resolve only to §4.1 tokens; no raw hexes in components.
2. Type uses only §4.2 scale tiers and the two Geist families.
3. The visibility-path motif (rails + scan trace + nodes) is present in mark, marketing, and live crawl.
4. Edge-ticks appear on section/card edges per §3.5 and never form closed frames.
5. Live crawl is a real seven-stage timeline with live counters (§14), not a spinner.
6. Every fixture (chart/table/tile/preview/example URL) shows a **Demo data** badge (§6.2).
7. Locked modules show honest *Integration required* states (§16); no fabricated live metrics.
8. All above-the-fold hero strings match §8 verbatim.
9. Homepage renders the exact 14 ordered sections (§11).
10. All states exist per the matrix (§16.3): loading, crawl, empty, integration, error, success.
11. WCAG 2.2 AA met: contrast pairs (§4.1), focus visible, 24px targets, keyboard model (§17).
12. `prefers-reduced-motion` disables scan/draw-on/shimmer while preserving meaning and `aria-live`.
13. Native scrolling only; no scroll hijacking, no audio.
14. Numerals are tabular and aligned; URLs/tags in mono.

### 7.2 Anti-copy gate (all must be false to ship)
1. Any moon/space/star/crater/mission/launch/orbit copy or imagery present.
2. A magnifying-glass icon used for search.
3. A robot/brain used for AI features.
4. Heavy gradients or glow beyond the single scan gradient.
5. A bento grid of equal rounded tiles as the primary layout.
6. Semrush-style orange or a dense toolbar clone.
7. A closed rectangular "frame" reproduction of the reference site.
8. Scroll-jacked or audio-driven sequences.
9. Any unbadged deterministic/example data shown as if live.
10. Uppercase wordmark or the accent moved off the `i` node.

---

## 8. Above the Fold Copy Lock

**LOCKED — do not alter without design sign-off.** Applies to the homepage hero (§11.2) and is echoed by auth/onboarding entry copy.

| Role | Exact text | Notes |
|------|-----------|-------|
| Wordmark | `searvia` | lowercase; scan-node accent on `i` |
| Headline | `See what is limiting your search visibility.` | `display-lg`/`display-md` responsive; `--ink` |
| Action line | `Audit. Rank. Get cited.` | `overline`, above headline as eyebrow |
| Subhead | `Searvia crawls your site, ranks the fixes by impact, and shows where you appear across search engines and AI answers.` | `body-lg`, `--text-secondary`, ~22 words |
| URL input placeholder | `enter a domain, e.g. demo-domain.example` | mono; the path's first node |
| Primary CTA | `Start a free audit` | `--accent-action` |
| Secondary CTA | `See a demo report` | tertiary/link; opens a fully **Demo data** report |
| Assurance line | `No credit card. First crawl in minutes.` | `caption`, `--text-muted`, under input |
| Demo note | `Figures shown are Demo data.` | `caption`; attached to any above-fold example |

---

## 9. Iconography and Data Visualization

### 9.1 Icon system
- **Grid:** 24×24, `1.75px` stroke, round joins, `2px` corner radius, `2px` keyline padding. A `20px` dense variant keeps `1.5px` stroke. Icons inherit `currentColor`; accent color only when the icon *is* the meaning (e.g., a severity dot).
- **Language:** icons echo the rails/scan-node vocabulary — directional strokes, a small leading node — so navigation and status feel part of the path.
- **A11y:** decorative icons `aria-hidden="true"`; standalone icon buttons carry `aria-label`; status icons pair with visible text (never color/icon only).

**Inventory (approved glyphs).**

| Concept | Glyph description | Notes |
|---------|-------------------|-------|
| `search` | two short rails meeting at a leading node | **not** a magnifying glass |
| `aiAnswer` / presence | opening quotation bracket with a citation dot | **not** a brain/robot |
| overview | stacked hairlines + node | nav |
| siteAudit | page outline with a scan tick | nav |
| rankings | ascending steps with a position dot | nav (locked) |
| competitors | two offset bars | nav (locked) |
| citations | quote bracket + link | nav (locked) |
| settings | slider ticks (ruler-like) | avoids gear cliché but gear allowed at 20px |
| runCrawl | node with forward chevron | primary action |
| pause / resume | bars / forward node | crawl controls |
| cancel | node with x | crawl |
| compare | two nodes on a timeline | crawl compare |
| filter | descending ticks | tables |
| export | tray with up-arrow | tables |
| connect | plug + node | integrations |
| site / page / issue | globe-dot / page / triangle-tick | object types |
| status: ok/redirect/broken | check / turn-arrow / broken-link | HTTP |
| severity | filled dot in severity color + label | never color-only |
| external link | arrow leaving a corner tick | opens new tab (announced) |

### 9.2 Data visualization
Charts are **instruments**: hairline axes, `mono` numerals, restrained series color, direct labels over legends where space allows. Encoding is never color-only — every series has a direct label, marker shape, or table fallback.

| Chart | Where | Encoding | Series color |
|-------|-------|----------|--------------|
| Visibility-score trend | Overview, Site Audit | area+line over a timeline; score 0–100 | `--accent-data` line, `--blue-50` fill |
| Rankings over time | Rankings | multi-line; **position axis inverted** (#1 at top); direct end-labels | `--accent-data`, `--accent-citation`, `--indigo-500`, `--gray-600` |
| Position distribution | Rankings, Site Audit | segmented bar (1–3 / 4–10 / 11–20 / 21+) | teal→blue→indigo→gray steps + labels |
| Share of visibility | Competitors | horizontal stacked bar (you vs rivals); **not a pie** — bars compare lengths precisely and label directly | you `--accent-action`, rivals gray/blue steps |
| AI-answer presence share | AI Presence | dot-matrix (10×10 = 100 answers), filled = cited | filled `--accent-citation` |
| Issues by severity | Site Audit, Issues | vertical bar in severity colors + counts | severity scale |
| Crawl coverage / status mix | Site Audit, Page | segmented bar (2xx/3xx/4xx/5xx) | success/info/warning/danger |
| Sparkline | stat tiles | 40×16 line, last-point dot | `--accent-data` |

**Chrome tokens.** Axis/gridline: `1px --border-hairline`; ticks: `--tick-*` meaningful set; axis labels `caption --text-muted`; value labels `mono --text-secondary`. **Hover crosshair** is a vertical `--accent-data` hairline (the scan-trace idea applied to charts) with a value tooltip. Legend only when >4 series or no room for direct labels; legend markers use shape + color.

**Chart states.**
- *Loading:* skeleton — axis hairlines drawn, series area a shimmering `--gray-100` block (shimmer off under reduced motion).
- *Empty:* muted axes + centered "No data for this range" + range control.
- *Error:* axes + inline error row + `Retry`.
- *Demo:* every fixture chart carries `<DemoBadge/>` top-right.

**Motion.** Entrance draw-on `--dur-slow --ease-out`; disabled under reduced motion (render final). Hover crosshair `--dur-fast`.

**Accessibility.** Each chart has a visually-available **"View as table"** toggle producing the underlying data grid; `role="img"` with `aria-label` summary (e.g., "Visibility score trend, Demo data, 30 days, ending 71, up 6"); series described in an off-screen `<figcaption>`; keyboard-focusable data points with `aria-live` value read-out.

---

## 10. Component Library

Conventions for every component: sizes `sm(32) / md(40) / lg(48)` control heights; focus is always `--ring-focus`; disabled = `--gray-300` text on `--gray-50`, `cursor:not-allowed`, `aria-disabled`; hover uses `--surface-sunken` or a 6% accent tint; motion `--dur-fast/base`. Rails/edge-ticks recur as noted.

### 10.1 Buttons
| Variant | Fill / text | Use |
|---------|-------------|-----|
| primary | `--accent-action` bg / white | one per view; main action |
| secondary | `--surface` bg / `--ink`, `1px --color-border` | supporting |
| tertiary / link | transparent / `--accent-data` | low emphasis, inline |
| ghost | transparent / `--ink`, hover `--gray-50` | toolbars |
| danger | `--danger` bg / white | destructive confirm only |
| icon-button | square, `aria-label` required | table/toolbar actions |

States: default/hover(−8% lum)/active(−14%)/focus-visible/loading(spinner + label retained, `aria-busy`)/disabled. **Split button** = primary + attached menu caret. Sizes sm/md/lg. Min target 40×40 (24 exception only in dense tables with spacing).

### 10.2 Inputs
- **Hero URL input** (`<UrlPathInput/>`): `lg` height, `mono` value, left **node glyph** (the path origin), leading protocol auto-normalized (`https://` optional), inline validation (invalid domain → `--danger` hairline + message), paste-to-fill, example hint `demo-domain.example`, submit = primary `Start a free audit` / in-app `Run crawl`. On submit, the node lights and a rail extends rightward — visually launching the path.
- **Text / textarea / number:** `1px --color-border`, `radius-sm`, `40px`, focus ring; error state hairline `--danger` + helper text with `aria-describedby`; character count for limited fields.
- **Select / combobox:** button + listbox popover, typeahead filter, keyboard roving, selected check; **multiselect** renders removable chips.
- **Checkbox / radio / switch:** 20px control, `--accent-action` when on; switch animates `--dur-fast` (instant under reduced motion); grouped with `<fieldset>/<legend>`.
- **Slider / range:** single + dual-thumb (crawl-compare range); **dragging alternative** = numeric steppers + arrow keys (WCAG 2.2 dragging).
- **Date / date-range:** popover calendar; presets (Last 7/30/90 days); range used by comparison.

### 10.3 Badges, chips, tags
- **Status badge:** icon + label pill; status colors; `radius-full`.
- **Severity badge:** filled dot + label (Critical/High/Medium/Low/Notice).
- **DemoBadge:** per §6.2.
- **Count badge:** numeric, `mono`, on nav items and tabs.
- **Filter chip:** removable (`×`, `aria-label="Remove filter …"`), shows key:value.
- **Tag:** neutral `mono` pill for URL segments/labels.

### 10.4 Navigation & structure primitives
Tabs (underline indicator = a short active rail; roving tabindex), **segmented control** (dense toggles), breadcrumbs (`nav[aria-label="Breadcrumb"]`, last = `aria-current="page"`), pagination (numbered + prev/next, or `Load more`), **stepper** (used by onboarding §12 and crawl stages §14: pending/active/complete/error nodes on a rail).

### 10.5 Tables / data grid (`<DataGrid/>`)
- **Header:** sticky, `body-sm` `--text-secondary`, sortable columns show a sort tick; `aria-sort` on active.
- **Sticky first column** (URL) on horizontal scroll; body in a horizontal-scroll container with edge-tick shadow affordance.
- **Density:** comfortable (48px) / compact (36px); hairline row separators (zebra only in compare views).
- **Column types:** `url` (mono, truncation with tooltip + copy), `score` (numeral + sparkline), `delta` (signed, colored by direction), `severity` (badge), `status` (badge), `timestamp` (relative + absolute tooltip), `count`.
- **Selection:** header + row checkboxes → bulk action bar; **expandable rows** for inline evidence.
- **States:** loading = 8 skeleton rows; empty = empty-state block; error = inline row + `Retry`.
- **Keyboard:** arrow-key cell navigation, `Space` selects row, `Enter` opens detail, sort via focused header + `Enter`.

### 10.6 Filters
Filter bar with inline controls + overflow **filter popover**; heavy filtering opens a right **filter drawer**; active filters render as removable chips with a `Clear all`; **saved views** (named filter+sort combos) in a menu; sort menu separate. Filtering updates URL query params (shareable, back-button safe).

### 10.7 Overlays
- **Drawer** (`<DetailDrawer/>`): right side, `480px` (`560px` xl), `--elev-3`, header + scroll body + sticky footer actions; used for Issue/Page detail; focus trapped, `Esc` closes and returns focus; **mobile = full-height bottom sheet**.
- **Dialog / modal:** centered, `--elev-4`, `radius-xl`, max `560px`; confirm / form / **destructive** (destructive requires typed confirmation of the resource name); focus trap + restore; scrim `rgba(11,14,18,.32)`.
- **Menu / dropdown:** `--elev-2`, roving tabindex, `Esc`/outside-click close.
- **Tooltip:** `--dur-fast`, `caption`, dark `--gray-900` on `--white` text; keyboard-focus and hover triggered; never the only source of essential info.
- **Popover:** interactive companion to tooltip (filters, quick actions).
- **Command palette** (`⌘/Ctrl-K`): `--elev-4`, fuzzy search across nav, sites, issues, actions ("Run crawl", "Compare crawls"); `z-cmdk`.

### 10.8 Content blocks
- **Card:** `--surface`, `1px --color-border`, `radius-lg`, `--elev-1`, corner edge-ticks; optional header/footer.
- **Stat tile / KPI (`<StatTile/>`):** oversized value (`display-md`, tabular), label (`overline`), signed **delta** with direction color, optional **sparkline**, **DemoBadge**.
- **List row, accordion** (FAQ, page evidence groups; `aria-expanded`), **inline alert / banner** (info/warning/danger/success with icon + text + optional action), **toast / snackbar** (`role="status"` polite / `role="alert"` for errors; auto-dismiss 6s, pause on hover/focus, stacked bottom-right).
- **Progress family:** linear determinate, indeterminate (short waits only), **ring/score gauge** (visibility score, animated sweep, static under reduced motion), and the **staged crawl rail** (§14).
- **Skeleton:** `--gray-100` blocks, shimmer optional; **empty-state block** (`<EmptyState/>`: icon, title, one-line body, primary action) — see §16.

---

## 11. Homepage

One page, **14 ordered sections**, obeying sparse → dense → focused. Marketing max-width `1200px`, 12-col grid. Motif recurs as hairline rails between sections and corner edge-ticks on cards; timeline cues in the path explainer and outcomes. Entrance animations are opacity/translate only, disabled under reduced motion. **Above-fold copy is locked (§8).** Every example number, chart, and product-view-in-words carries a **Demo data** badge/caption.

> **Above-the-fold copy lock (restated):** Headline `See what is limiting your search visibility.` · Action line `Audit. Rank. Get cited.` · Subhead, CTAs, placeholder, assurance line exactly per §8.

### 11.1 Section 1 — Sticky top nav
Left: `searvia` wordmark. Center/right links: `Product`, `Pricing`, `FAQ`. Right: `Sign in` (tertiary), `Start a free audit` (primary). Sticky, `--surface` at 92% with hairline bottom border on scroll; height 64px; mobile collapses links into a menu button (sheet). `z-sticky`.

### 11.2 Section 2 — Hero (above the fold) · *sparse*
- Eyebrow (action line, `overline`): `Audit. Rank. Get cited.`
- Headline (`display-lg`/`display-md`): `See what is limiting your search visibility.`
- Subhead (`body-lg`): locked §8 text.
- **URL path input** (`<UrlPathInput/>`) with placeholder `enter a domain, e.g. demo-domain.example`; primary `Start a free audit` attached; below: `No credit card. First crawl in minutes.`
- Secondary link: `See a demo report` → opens the fully-badged Demo report.
- Right/inset: the **visibility path** rendered live — five nodes with a scan trace resting at `url`; on input focus the rail extends toward `crawl`. Caption `Figures shown are Demo data.`

### 11.3 Section 3 — Trust strip
Overline `Teams tune their visibility with Searvia`. A single hairline-bounded row of 5–6 monochrome placeholder logos, each with a small `Demo data` note beneath the row. No carousel auto-scroll.

### 11.4 Section 4 — The visibility path explainer · *begin densifying*
Oversized anchor: `one path, five checkpoints`. A horizontal timeline of the five nodes with a slow scan trace traveling left→right (static segment under reduced motion). Each node is a short column:

| Node | Micro-headline | Line |
|------|----------------|------|
| url | `Enter a domain` | Start from any URL. |
| crawl | `Gather evidence` | Searvia crawls pages and records what it finds. |
| rankings | `Track positions` | See where you rank over time. |
| citations | `Get cited` | See where you appear in AI answers. |
| actions | `Fix what matters` | Ranked fixes, highest impact first. |

### 11.5 Section 5 — Site Audit spotlight
Overline `Audit`. Headline `See the evidence behind every issue.` Split: copy left; right = described product view of the Site Audit (issue list + one expanded evidence row) with a **Demo data** ribbon. Bullets: crawl evidence, severity ranking, fix guidance. CTA `Start a free audit`.

### 11.6 Section 6 — Rankings spotlight
Overline `Rank`. Headline `Watch positions move, and know why.` Right = rankings-over-time chart (inverted position axis), **Demo data**. Honest line: "Rankings connect to Search Console or a rank-data source." CTA `See how rankings work`.

### 11.7 Section 7 — Competitor analysis spotlight
Overline `Compare`. Headline `Measure your share of visibility.` Right = horizontal share-of-visibility bars (you vs `rival-demo.example`), **Demo data**. CTA `See competitor view`.

### 11.8 Section 8 — Get cited: brand presence in AI answers
Overline `Get cited`. Headline `Show up in the answers, not just the links.` Right = AI-answer presence dot-matrix (cited vs not), **Demo data**, with a sample cited answer card (quotation-bracket glyph, never a brain). Honest line about the AI-answer source. CTA `See AI presence`.

### 11.9 Section 9 — How it works · *dense*
Overline `How it works`. Four steps on a rail: `1 Add your site` → `2 Run a crawl` → `3 Review ranked fixes` → `4 Connect rankings and AI presence`. Each: one line, node marker.

### 11.10 Section 10 — Why Searvia / prioritized actions · *densest*
Oversized anchor: `evidence, then priorities`. Instrument-styled block with edge-ticks. A described "top actions" panel where fixes are ordered by impact, each with severity badge, affected-page count, and estimated effort — all **Demo data**. Three differentiators (no competitor names): *Every issue carries its evidence* · *Fixes ranked by visibility impact* · *One path from crawl to citation*.

### 11.11 Section 11 — Outcomes metrics band
Three oversized figures (`display-md`, tabular), each a `<StatTile/>` with **Demo data**: `+18 avg. positions recovered`, `128 pages audited in the first crawl`, `23 issues ranked by impact`. Timeline cue baseline beneath the figures.

### 11.12 Section 12 — Testimonials
Overline `In their words`. Two quote cards (quotation-bracket glyph), attributed to demo personas ("Head of Growth, Northwind Demo"), each card noted **Demo data**. No auto-rotation.

### 11.13 Section 13 — Pricing · *focusing*
Overline `Pricing`. Three tiers; monthly/annual segmented toggle. Honest note under all tiers: "Rankings, Competitors, and AI presence require a connected data source."

| Tier | Price (Demo) | Crawl limit | Modules | Seats |
|------|--------------|-------------|---------|-------|
| **Starter** | `$0` | 1 site, 500 pages/crawl, monthly | Site Audit | 1 |
| **Pro** | `$49/mo` | 5 sites, 10k pages, weekly | Site Audit + Rankings + Competitors | 5 |
| **Scale** | `$149/mo` | 25 sites, 100k pages, daily | All incl. AI presence | 15 |

Pro is emphasized (accent border, `Most chosen` badge marked **Demo data**). CTAs: `Start free`, `Start Pro trial`, `Talk to us`.

### 11.14 Section 14 — Final CTA band + footer
CTA band: oversized `See what is limiting your search visibility.` + `<UrlPathInput/>` + `Start a free audit`. The path motif runs full-width beneath, scan trace resolving into the `actions` node. **Footer:** four link groups — *Product* (Site Audit, Rankings, Competitors, AI presence, Pricing), *Company* (About, Blog, Careers, Contact), *Resources* (Docs, FAQ, Changelog, Status), *Legal* (Privacy, Terms, DPA). Bottom row: `searvia` wordmark, `© 2026 Searvia`, locale. Closing hairline rail.

### 11.15 Responsive (homepage)
- **≥lg (1024):** two-column spotlights (copy + product view), full path timeline.
- **md (768–1023):** spotlights stack (copy above view); path timeline scrolls horizontally within its section (native, not hijacked).
- **sm (<768):** single column; hero input full-width, CTA below; nav → sheet; pricing tiers stack (Pro first); stat band → vertical.

---

## 12. Authentication and Onboarding

### 12.1 Login and Signup
**Layout:** split. Left = form (max `400px`, centered). Right (≥lg) = quiet **visibility-path panel** — cool-white field, hairline rails and a slow scan trace, the action line `Audit. Rank. Get cited.` set small; no photography, no forbidden imagery. Under `lg` the panel drops and the form centers.

**Signup fields:** work email, password (min 8, shows strength; visibility toggle), or `Continue with Google`, or `Email me a sign-in link` (magic link). Consent line links Terms/Privacy. Submit `Create account`.
**Login fields:** email, password, `Forgot password?`, `Continue with Google`, magic link. Submit `Sign in`.
**Reset flow:** email → "Check your inbox" confirmation → link → set-new-password → success → auto sign-in.

**States & microcopy.** Inline validation with `aria-describedby`; auth errors as a section alert ("That email or password is incorrect."); loading = button spinner + `aria-busy`; success routes to onboarding (new) or last location (returning). **Accessible authentication (WCAG 2.2):** no cognitive puzzle CAPTCHA; `autocomplete` on all fields; magic-link and OAuth satisfy the no-memorization path.

### 12.2 Seven-step onboarding
A wizard framed as **building the visibility path**. Persistent left/top stepper (7 nodes on a rail); each completed step lights its node. `Back` always available; most steps offer `Skip for now`. Progress is saved; user can exit and resume (resume banner on next login). Prefilled examples badged **Demo data**.

| Step | Title | Purpose / controls | Validation & skip |
|------|-------|--------------------|-------------------|
| 1 | **Add your site** | `<UrlPathInput/>` — the path begins; the `url` node lights. | Valid domain required; no skip. |
| 2 | **Verify ownership** | Choose DNS TXT / HTML file / analytics; copy-to-clipboard token; `Verify`. | Skippable → reduced features noted; states: unverified/checking/verified/failed. |
| 3 | **Set your market** | Country/locale, language, device (mobile/desktop) toggles. | Defaults to detected locale; editable; no skip. |
| 4 | **Add competitors** | 0–3 competitor domains (chips); suggestions from the same space (Demo data). | Optional; `Skip for now`. |
| 5 | **Choose keywords/topics** | Add tracked keywords/topics; suggestion list (Demo data); can defer. | Optional; `Skip for now`. |
| 6 | **Configure the first crawl** | Scope (subdomains, include/exclude paths), max pages, depth, JS rendering, respect robots (on by default). | Safe defaults prefilled; editable. |
| 7 | **Review and launch** | Summary of steps 1–6; `Launch crawl` primary. | Launch hands off to the **live crawl** screen (§14). |

**Completion transition.** `Launch crawl` animates the scan trace from `url` toward `crawl`, then routes into the **product shell** with the Overview in first-run state and the crawl running live. Empty/error per step use the global patterns (§16).

---

## 13. Product Shell and Overview

### 13.1 Shell anatomy
```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: [site switcher ▾] [market] · [⌘K search] [alerts][help][acct]│
├────────────┬─────────────────────────────────────────────────┤
│ Sidebar    │ Breadcrumb: Overview                             │
│ ▚ overview │ ┌─────────────────────────────────────────────┐ │
│  siteAudit │ │  content region (edge-ticks on outer edge)  │ │
│  rankings🔒│ │                                             │ │
│  competit🔒│ │                                             │ │
│  aiPres. 🔒│ │                                             │ │
│  ─────     │ └─────────────────────────────────────────────┘ │
│  settings  │ minimal footer: status · docs · version         │
└────────────┴─────────────────────────────────────────────────┘
```
- **Sidebar** (`240px`, collapsible to `64px` icons): the **rail motif is the nav spine** — a hairline rail runs top-to-bottom; the active item shows a `3px` active rail segment + `--accent-action` label. Items: Overview, Site Audit, Rankings 🔒, Competitors 🔒, AI Presence 🔒, divider, Settings. **Locked items** show a small lock and route to their *Integration required* state (§16), not a dead end.
- **Topbar** (`56px`): site/project switcher (search + recent), market/locale chip, `⌘K` command-palette trigger (with a visible hint), notifications (crawl-complete, integration-expired), help, account menu (profile, billing, sign out).
- **Breadcrumbs** below topbar for nested routes (e.g., Site Audit → Issues → *Missing meta description*).
- **Content region:** `--surface-app`, max `1440px`, outer edge-ticks; cards on `--surface`.
- **Footer:** crawl/system status dot, docs link, build version.
- **Optional initialization loader:** ≤800ms brand splash — wordmark with a single scan-trace pass across a rail, then content. Skipped under reduced motion (instant). Never blocks longer; real work uses the staged crawl, not this loader.

**Responsive shell.** ≥xl full sidebar; lg icon-rail; <md sidebar becomes a **drawer/sheet** via a menu button, topbar condenses (switcher + `⌘K` + account). Skip-to-content link is first focusable; landmarks: `header`, `nav`, `main`, `contentinfo`.

### 13.2 Overview screen
The at-a-glance visibility state; sparse → dense → focused top to bottom. All metrics **Demo data**.

1. **Header row:** page title `Overview`, site chip, `Run crawl` primary, last-crawl timestamp.
2. **Visibility score gauge:** ring 0–100 (`display-md` center value), delta vs last crawl (signed, colored), the score sitting as the resolved end of the path.
3. **Stat tiles row:** `Issues open` (with severity split), `Pages crawled`, `Health` (%), and **locked teasers** `Rankings — connect` / `AI presence — connect` styled as integration-required tiles.
4. **Latest crawl card:** status (complete/running/failed), pages, issues, duration, timestamp, `Re-run` / `View audit`. If a crawl is running, this card embeds the live stage rail (§14).
5. **Top actions:** ranked list of highest-impact fixes (severity badge, affected pages, effort), each linking into Issues/Issue detail.
6. **Recent activity timeline:** crawls, fixes marked, integrations connected — as a vertical timeline with node markers.
7. **Module teasers:** cards for Rankings/Competitors/AI Presence → their *Integration required* states.

**States.** *First-run* (no crawl yet): gauge/tiles show an empty-state — `No crawl yet. Run your first audit to see what's limiting visibility.` + `Run first crawl`; teasers still shown. *Loading:* skeleton gauge + tiles + rows. *Populated:* as above with **Demo data**.

---

## 14. Site Audit Live Crawl and Crawl Management

### 14.1 Site Audit screen
Entry point to all crawl evidence. Layout:
1. **Summary band:** visibility/health score + delta vs previous crawl; crawl meta (pages, duration, timestamp); `Run new crawl`, `Compare crawls`.
2. **Issues by severity** bar chart + counts (links to Issues filtered by severity).
3. **Issue-category breakdown** table/chart (Indexing, Content, Links, Performance, Structured data, Meta) with counts and trend.
4. **Crawl coverage / status mix** segmented bar (2xx/3xx/4xx/5xx) → links to Crawled Pages filtered.
5. **Trend** vs previous crawls (visibility-score line, timeline).
6. Entries: `View all issues`, `View crawled pages`.
**States:** no-data (run first crawl), loading (skeletons), populated (**Demo data**), partial (from a cancelled crawl — banner "Showing partial results from a cancelled crawl").

### 14.2 Live crawl progress — the required staged experience
This is the centerpiece of the living visibility path: a **real seven-stage timeline** with live counters, never a bare spinner. Rendered full-width (own route `…/crawl/[crawlId]`) and embedded compactly in the Overview latest-crawl card.

**Stage model.**

| # | Stage | Substatus / live counters | Node behavior |
|---|-------|---------------------------|---------------|
| 1 | **Queued** | position in queue; "Starting shortly" | node pending → active |
| 2 | **Resolving** | domain resolved, robots.txt fetched, sitemap found (N urls) | rail extends to `crawl` |
| 3 | **Crawling** | live: `discovered`, `fetched`, `in queue`, current URL (mono, truncated) | scan trace loops on this segment |
| 4 | **Extracting evidence** | titles, meta, headings, links, structured data parsed (per-page tick) | segment fills |
| 5 | **Analyzing + scoring** | `issues found` rising, split by severity as they appear | segment fills |
| 6 | **Compiling report** | building audit, scoring visibility | near-complete |
| 7 | **Done** | "Results ready — 128 pages, 23 issues" | `actions` node lights |

**UI anatomy.**
- **Horizontal stage rail** (the visibility path) across the top: seven nodes, each *pending / active / complete / error*; the **scan trace** advances along the active segment and maps to real percent. Under reduced motion the trace is a static filled segment sized to percent; counters still update.
- **Active-stage panel:** big stage label (`display-md`, e.g., `crawling`), current-activity line (current URL), and **live counters** in `mono` tabular (all **Demo data** in fixtures).
- **Meta row:** elapsed (`4m 12s`), ETA (`~2m left`), crawl scope summary.
- **Controls:** `Pause` / `Resume`, `Cancel crawl` (confirm dialog; cancel keeps partial results → routes to Site Audit partial state). While running, `View partial results` peeks at what is scored so far.
- **Live region:** counters and stage changes announced via `aria-live="polite"`; completion via `role="status"`.

**Error handling (per stage).**
| Error | Message + recovery |
|-------|--------------------|
| Blocked by robots.txt | "Crawl blocked by robots.txt. Searvia respects it. Allow the Searvia agent or upload a sitemap." + `Edit crawl settings` |
| DNS / unreachable | "Couldn't reach demo-domain.example." + `Retry` |
| Timeouts / slow | inline warning, continues; flagged in coverage |
| Rate-limited | "Slowing down to respect the server." auto-throttle, no user action |
| Partial completion | on cancel/limit: "Showing partial results (84 of ~500 pages)." |

**Completion transition.** On Done, `Results ready` success state → auto-route to Site Audit (or user clicks `Review top actions`). The scan trace resolves into the `actions` node.

### 14.3 Crawl settings
Form (Settings → Crawl, and editable from onboarding step 6):
- **Scope:** include subdomains (toggle), include/exclude path patterns (glob chips), start URLs.
- **Limits:** max pages, max depth, crawl rate / concurrency, timeout.
- **Rendering:** JS rendering toggle (note: slower, more accurate for SPAs).
- **Identity:** user-agent string, respect robots.txt (on by default; turning off warns).
- **Sources:** sitemap URL(s), authentication for gated sites (basic/header/cookie).
- **Schedule:** manual / daily / weekly (with time + timezone).
Safe defaults prefilled; validation on limits (e.g., max pages ≥ 1); `Save` / `Save and run`.

### 14.4 Crawl comparison
Select **crawl A vs crawl B** (date-range/crawl pickers). Output:
- **Delta band:** visibility score change (signed), duration, page-count change.
- **Issues diff:** three tallies — `New`, `Resolved`, `Regressed` — each expandable to the issue list (zebra compare grid).
- **Pages diff:** `Added / Removed / Changed` (status or issue changes).
- **Timeline:** both crawls on a visibility-score line with A/B markers.
All values **Demo data**; empty state when only one crawl exists ("Run another crawl to compare.").

---

## 15. Issues and Crawled Pages

### 15.1 Issues list
`<DataGrid/>` of issues found by the latest crawl. All data **Demo data**.

| Column | Type | Notes |
|--------|------|-------|
| Severity | severity badge | sortable; primary sort |
| Issue | text | name, e.g. `Missing meta description` |
| Category | tag | Indexing / Content / Links / Performance / Structured data / Meta |
| Affected pages | count | links to Pages filtered |
| First seen | timestamp | which crawl introduced it |
| Trend | delta | vs previous crawl (▲ new / ▼ fewer) |
| Status | badge | Open / Ignored / Fixed |

- **Filter bar:** severity, category, status, `changed since` (date). Active filters → removable chips + `Clear all`. **Saved views** (e.g., "Critical open").
- **Bulk actions:** select rows → `Ignore`, `Mark fixed`, `Export`.
- **Row click:** opens **Issue detail** as a right drawer (list context preserved); deep link opens it as a full page.
- **States:** empty = positive clean state (`No open issues in this crawl. Nice — run another crawl to keep it clean.`); loading = skeleton rows; error = inline + `Retry`.

### 15.2 Issue detail (drawer + page)
- **Header:** issue name, severity badge, priority/impact, status control (Open/Ignored/Fixed) with change history.
- **What this is:** plain-language definition.
- **Why it matters for visibility:** the impact rationale.
- **How to fix:** numbered steps, with the exact change to make.
- **Evidence:** the offending artifact in `mono` (e.g., the empty `<meta name="description">`), copyable.
- **Affected pages:** list linking to Page detail; counts.
- **History:** first seen, crawls where present, when fixed.
- **Related issues:** links. Footer actions: `Mark fixed`, `Ignore`, `Open first affected page`.

### 15.3 Crawled Pages list
`<DataGrid/>` of every crawled URL. **Demo data.**

| Column | Type | Notes |
|--------|------|-------|
| URL | url (mono) | sticky first column; copy + open |
| Status | status badge | 2xx/3xx/4xx/5xx |
| Indexable | badge | Yes / No (+reason) |
| Depth | count | clicks from start |
| Issues | count | links to page's issues |
| Title | check | present / missing |
| Meta desc | check | present / missing |
| Words | count | content length |
| Response | ms | load time |
| Last crawled | timestamp | relative |

- **Filters:** status code, indexability, has-issues, depth, path segment. **Search** by URL. **Segments** (saved path filters). Sort, export.
- **Row click:** **Page detail** (drawer + deep-linkable page).
- **States:** empty (`No pages match these filters.` + `Clear filters`), loading skeleton, error + `Retry`.

### 15.4 Page detail (drawer + page)
- **Header:** URL (mono, copy, open), final status, indexability + canonical.
- **Redirect chain:** hops with status codes (timeline).
- **Response headers of note:** content-type, cache, robots header.
- **On-page evidence:** title, meta description, **headings outline** (H1–H6 tree), structured-data types found, internal links in/out counts.
- **Issues on this page:** list linking to Issue detail.
- **Render snapshot:** described DOM/render capture (labeled **Demo data**).
- **Crawl history:** per-page timeline across crawls (status/issue changes).

---

## 16. Later Modules Integration States and Global States Catalog

### 16.1 Integration-required modules
Modules 2–4 (and Backlinks) are **honestly gated** until a data source is connected. They never show fabricated live metrics. Each locked module screen has the same anatomy: what it *will* show (described), the required source, a `Connect …` primary CTA, a secondary `Preview with Demo data`, and the connection-state machine.

| Module | Requires | Primary CTA | Once connected shows |
|--------|----------|-------------|----------------------|
| **Rankings** | Google Search Console **or** a rank-data source | `Connect Search Console` | positions over time, distribution, movers |
| **Competitors** | a competitor set + a visibility data source | `Set up competitors` | share-of-visibility, gap analysis |
| **Brand presence in AI answers** | an AI-answer monitoring source/API | `Connect AI monitoring` | citation share, cited answers, sources |
| **Backlinks** (optional) | a backlink data source | `Connect backlink source` | referring domains, new/lost links |

**Connection state machine:** `not-connected → connecting → connected → error/expired`.
- *not-connected:* the integration-required empty state (icon = `connect` glyph, not a lock illustration cliché; title, one-line value, `Connect …`, `Preview with Demo data`).
- *connecting:* inline progress + `aria-busy`; cancelable.
- *connected:* live module renders (no Demo badge on real data); a `Manage connection` link.
- *error/expired:* alert "Connection to Search Console expired. Reconnect to resume rankings." + `Reconnect`.

**Preview with Demo data:** opens the real module layout populated entirely with fixtures behind a persistent **Demo data ribbon** (top-right) and a footnote "Every figure on this screen is Demo data." A dismissible banner reminds "This is a preview. Connect a source to see your data." Never presented as live.

**Locked treatment** appears in the sidebar (lock glyph, routes to the module's not-connected state) and as Overview teaser tiles/cards.

### 16.2 Global states catalog (reusable)
| State | When | Anatomy | Copy pattern | A11y / motion |
|-------|------|---------|--------------|---------------|
| **Loading** | fetching known-shape data | skeletons matching final layout; spinner only for <400ms unknown waits | — | shimmer off under reduced motion; `aria-busy` |
| **Crawl / progress** | long staged work | the seven-stage rail (§14) | stage label + counters | `aria-live="polite"` counters |
| **Empty — first run** | no data ever created | `<EmptyState/>` + primary action | "No {thing} yet. {value}." + `{verb}` | icon decorative |
| **Empty — no results** | filters/search exclude all | `<EmptyState/>` + `Clear filters` | "No {thing} match these filters." | — |
| **Empty — cleared** | user emptied a set | subtle inline note | "Nothing here right now." | — |
| **Integration required** | module needs a source | connect card + preview | per §16.1 | — |
| **Error — page** | route-level failure | centered error block + `Retry` + support link | "Something went wrong loading {thing}." | `role="alert"` |
| **Error — section** | one panel failed | inline card error + `Retry` | "Couldn't load {thing}." | `role="alert"` |
| **Error — inline field** | validation | field hairline `--danger` + helper | "{what} and how to fix" | `aria-describedby` |
| **Error — toast** | async action failed | toast | "Couldn't {action}. Try again." | `role="alert"` |
| **Partial failure** | some data loaded | banner above content | "Showing partial results." | — |
| **Success / confirmation** | action completed | toast or inline banner | "{done}. {next step}." | `role="status"` |
| **Permission / access** | user lacks access | `<EmptyState/>` (no data leaked) | "You don't have access to {thing}." + `Request access` | — |

Illustration approach for all: the `connect`/object glyphs and hairline rail motif — **never** forbidden imagery (no robot/space/magnifier).

### 16.3 State × screen matrix
| Screen | Loading | Crawl | Empty | Integration | Error | Success |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|
| Overview | ✓ | ✓(embed) | ✓ first-run | ✓ teasers | ✓ | ✓ |
| Site Audit | ✓ | ✓ partial | ✓ no-data | — | ✓ | ✓ |
| Live crawl | — | ✓ | — | — | ✓ per-stage | ✓ done |
| Issues | ✓ | — | ✓ clean/no-results | — | ✓ | ✓ bulk |
| Crawled Pages | ✓ | — | ✓ no-results | — | ✓ | — |
| Crawl compare | ✓ | — | ✓ needs 2 crawls | — | ✓ | — |
| Rankings | ✓ | — | — | ✓ | ✓ | ✓ connected |
| Competitors | ✓ | — | — | ✓ | ✓ | ✓ |
| AI Presence | ✓ | — | — | ✓ | ✓ | ✓ |
| Settings | ✓ | — | — | — | ✓ | ✓ saved |

---

## 17. Accessibility and Responsive Rules

### 17.1 WCAG 2.2 AA conformance
- **Contrast:** body text pairs meet ≥4.5:1, large text/UI ≥3:1 per §4.1 (text-muted `#6B7480` 4.6:1, secondary `#505A66` 7.0:1, primary `#0B0E12` 17.8:1; primary button white-on-indigo 5.9:1; links `#0A6FDB` 4.7:1; citation text `#0B7568` 4.6:1). Status/severity never encoded by color alone — always icon + label.
- **2.2 additions explicitly handled:**
  - *Focus not obscured (min):* sticky topbar/nav offset scroll so a focused element is never fully hidden behind it.
  - *Focus appearance:* `--ring-focus` = 2px ring + 2px offset, contrast ≥3:1 against adjacent colors.
  - *Target size (min 24px):* interactive targets ≥24×24 with spacing; standard controls 40px; dense-table 24px targets keep ≥24px spacing.
  - *Dragging movements:* every slider/range (crawl-compare, rate) has stepper + arrow-key alternatives; no drag-only interactions.
  - *Consistent help:* help/account entry points sit in the same topbar location across screens.
  - *Redundant entry:* onboarding never re-asks known info; values carry forward.
  - *Accessible authentication:* no cognitive-test CAPTCHA; OAuth + magic link + `autocomplete` provide non-memorization paths.

### 17.2 Focus, keyboard, live regions
- **Focus order** follows DOM/reading order; skip-to-content link is first focusable; roving tabindex in menus, tabs, toolbars, segmented controls.
- **Focus trap + restore** in drawers/dialogs/command palette; `Esc` closes and returns focus to the trigger.
- **Live regions:** crawl counters/stage `aria-live="polite"`; success `role="status"`; errors `role="alert"`; validation summaries associated via `aria-describedby`.
- **Landmarks:** `header` `nav` `main` `contentinfo`; one `h1` per screen; ordered headings.
- **Charts/grids:** each chart has a "View as table" and `role="img"` summary (§9.2); grids expose `aria-sort`, row/cell semantics, and keyboard cell navigation.

**Per-component keyboard model.**
| Component | Keys |
|-----------|------|
| Global | `⌘/Ctrl-K` palette, `/` focus search, `g o` Overview, `g a` Site Audit |
| Menu / dropdown | ↑↓ move, `Enter` select, `Esc` close, `Home/End` |
| Tabs / segmented | ←→ move, `Enter/Space` activate |
| Data grid | ←→↑↓ cells, `Space` select row, `Enter` open, header `Enter` sort |
| Drawer / dialog | trap, `Esc` close, `Tab` cycles |
| Stepper | `Enter` advance, `Shift+Tab` back, disabled future steps skipped |
| Slider / range | ←→ ±step, `Shift` ±10, `Home/End` min/max |
| URL input | `Enter` submit/crawl |

### 17.3 Reduced-motion contract
`prefers-reduced-motion: reduce` disables: scan-trace travel (→ static filled segment), rail-extend animation, chart draw-on (render final), skeleton shimmer, gauge sweep, entrance transitions. Preserved: instant state changes, focus rings, and **all `aria-live` announcements** (counters still update). No essential information is conveyed by motion alone.

### 17.4 Responsive rules
Breakpoints/containers/grid per §4.6. Behavior by surface:

| Surface | ≥xl | lg | md | sm |
|---------|-----|----|----|----|
| Marketing | 2-col spotlights, full path | same | stacked spotlights, path scrolls in-section | single column, sheet nav |
| Shell | full sidebar | icon-rail sidebar | drawer sidebar, condensed topbar | drawer + condensed |
| Data grid | full columns | full + horizontal scroll | sticky URL col + scroll | **stacked-card rows** (label:value) |
| Drawer | 560px right | 480px right | 480px right | **full-height bottom sheet** |
| Dialog | centered 560px | centered | centered, margins | full-width, bottom-anchored |
| Charts | full | full | reflow height | simplified, table toggle prominent |
| Hero input | inline + CTA | inline | inline | full-width, CTA below |

Touch targets ≥44px on coarse pointers; horizontal scroll is native with edge-tick shadow affordance; no scroll hijacking anywhere.

---

## 18. Engineering File Map

Next.js **App Router** + React + Tailwind. Documentation only — not a runnable app.

### 18.1 Route tree
```
app/
  layout.tsx                      # root: fonts (Geist), :root tokens, skip-link
  (marketing)/
    page.tsx                      # homepage — 14 sections (§11)
    pricing/page.tsx
    faq/page.tsx
    legal/{privacy,terms,dpa}/page.tsx
  (auth)/
    login/page.tsx                # §12.1
    signup/page.tsx
    reset/page.tsx
  (onboarding)/
    onboarding/layout.tsx         # 7-step stepper shell (§12.2)
    onboarding/[step]/page.tsx    # steps 1–7
  (app)/
    layout.tsx                    # product shell: sidebar, topbar, breadcrumbs (§13.1)
    overview/page.tsx             # §13.2
    site-audit/page.tsx           # §14.1
    site-audit/crawl/[crawlId]/page.tsx   # live crawl (§14.2)
    issues/page.tsx               # §15.1
    issues/[issueId]/page.tsx     # §15.2 (drawer deep-link)
    pages/page.tsx                # §15.3
    pages/[pageId]/page.tsx       # §15.4
    crawls/compare/page.tsx       # §14.4
    settings/{account,crawl,integrations}/page.tsx  # §14.3, §16.1
    rankings/page.tsx             # integration-required (§16.1)
    competitors/page.tsx          # integration-required
    ai-presence/page.tsx          # integration-required
```

### 18.2 Components & lib
```
components/
  ui/            # §10 primitives: Button, UrlPathInput, Input, Select, Checkbox,
                 #   Switch, Slider, Badge, DemoBadge, Chip, Tabs, SegmentedControl,
                 #   Breadcrumbs, Pagination, Stepper, Tooltip, Popover, Menu,
                 #   Drawer, Dialog, Toast, Card, StatTile, Accordion, Alert, Skeleton
  charts/        # §9.2: ScoreTrend, RankingsLines, PositionDistribution,
                 #   ShareOfVisibility, AiPresenceMatrix, SeverityBars, Sparkline, ChartTable
  path-motif/    # Rails, ScanTrace, PathNodes, EdgeTicks, VisibilityPath
  shell/         # Sidebar, Topbar, CommandPalette, Breadcrumbs, InitLoader
  tables/        # DataGrid, FilterBar, SavedViews, BulkActionBar
  states/        # EmptyState, ErrorState, IntegrationRequired, LoadingSkeletons, CrawlProgress
  marketing/     # Hero, TrustStrip, PathExplainer, Spotlight, PricingTable, Faq, Footer
lib/
  demo-data/     # single source of every "Demo data" fixture (crawls, issues, pages,
                 #   rankings, competitors, citations) — all flagged isDemo:true
  tokens.ts      # token constants mirrored from :root (§4.7)
  format.ts      # numbers (tabular), dates, durations, deltas (§6.1)
  domain.ts      # interface sketches (below)
styles/
  globals.css    # :root custom props (§4.7), base layer, prefers-reduced-motion block
tailwind.config.ts
```

### 18.3 Domain interface sketches
```ts
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'notice';
type CrawlStage = 'queued' | 'resolving' | 'crawling' | 'extracting'
  | 'analyzing' | 'compiling' | 'done' | 'error';
type IntegrationStatus = 'not_connected' | 'connecting' | 'connected' | 'error' | 'expired';

interface Site { id: string; domain: string; market: { country: string; locale: string; device: 'mobile'|'desktop' }; verified: boolean; }
interface Crawl { id: string; siteId: string; stage: CrawlStage; discovered: number; fetched: number; issuesFound: number; visibilityScore: number; startedAt: string; finishedAt?: string; partial?: boolean; isDemo?: boolean; }
interface Page { id: string; url: string; status: number; indexable: boolean; depth: number; issueIds: string[]; hasTitle: boolean; hasMetaDescription: boolean; words: number; responseMs: number; lastCrawledAt: string; }
interface Issue { id: string; name: string; severity: Severity; category: 'indexing'|'content'|'links'|'performance'|'structured-data'|'meta'; affectedPageIds: string[]; status: 'open'|'ignored'|'fixed'; firstSeenCrawlId: string; evidence: string; }
interface Ranking { keyword: string; position: number; date: string; }             // requires Search Console
interface Competitor { domain: string; shareOfVisibility: number; }                 // requires source
interface AiAnswerPresence { query: string; cited: boolean; source?: string; }      // requires AI monitoring
interface Integration { module: 'rankings'|'competitors'|'ai-presence'|'backlinks'; status: IntegrationStatus; provider?: string; }
```

### 18.4 Tailwind theme mapping (illustrative)
```ts
// tailwind.config.ts — binds §4 tokens to Tailwind
export default {
  theme: {
    screens: { sm:'640px', md:'768px', lg:'1024px', xl:'1280px', '2xl':'1536px' },
    extend: {
      colors: {
        surface:'var(--surface)', app:'var(--surface-app)', sunken:'var(--surface-sunken)',
        border:'var(--color-border)', hairline:'var(--border-hairline)',
        ink:'var(--ink)', 'text-secondary':'var(--text-secondary)', 'text-muted':'var(--text-muted)',
        action:'var(--accent-action)', data:'var(--accent-data)', citation:'var(--accent-citation)',
        sev:{ critical:'var(--sev-critical)', high:'var(--sev-high)', medium:'var(--sev-medium)',
              low:'var(--sev-low)', notice:'var(--sev-notice)' },
      },
      fontFamily: { sans:['Geist','ui-sans-serif','system-ui'], mono:['"Geist Mono"','ui-monospace'] },
      fontSize: {
        'display-xl':['4.5rem',{lineHeight:'1',letterSpacing:'-0.03em',fontWeight:'600'}],
        'display-lg':['3.5rem',{lineHeight:'1.02',letterSpacing:'-0.025em',fontWeight:'600'}],
        h1:['2rem',{lineHeight:'1.15',letterSpacing:'-0.015em'}],
        body:['1rem',{lineHeight:'1.55'}], 'body-sm':['0.875rem',{lineHeight:'1.5'}],
        overline:['0.6875rem',{lineHeight:'1.2',letterSpacing:'0.12em'}],
      },
      spacing:{ '1':'4px','2':'8px','3':'12px','4':'16px','5':'20px','6':'24px','8':'32px','10':'40px','12':'48px','16':'64px' },
      borderRadius:{ xs:'4px', sm:'6px', md:'8px', lg:'12px', xl:'16px', '2xl':'24px', full:'9999px' },
      boxShadow:{ e1:'var(--elev-1)', e2:'var(--elev-2)', e3:'var(--elev-3)', e4:'var(--elev-4)' },
      zIndex:{ sticky:'100', dropdown:'1000', drawer:'1100', dialog:'1200', cmdk:'1250', toast:'1300', tooltip:'1400' },
      keyframes:{ scan:{ '0%':{transform:'translateX(0)',opacity:'.2'},'50%':{opacity:'.9'},'100%':{transform:'translateX(calc(100% - var(--scan-len)))',opacity:'.2'} } },
      animation:{ scan:'scan var(--dur-scan) var(--ease-scan) infinite' }, // disabled via motion-reduce:animate-none
    },
  },
}
```

**Token → Tailwind name.**
| Token | Tailwind |
|-------|----------|
| `--accent-action` | `bg-action` / `text-action` |
| `--accent-data` | `text-data` / `border-data` |
| `--accent-citation` | `text-citation` |
| `--sev-*` | `text-sev-critical` … |
| `--elev-2` | `shadow-e2` |
| `display-lg` | `text-display-lg` |
| `--dur-scan`/`--ease-scan` | `animate-scan` (+ `motion-reduce:animate-none`) |

**Global CSS.** `styles/globals.css` declares the `:root` block (§4.7), a base layer (body `--surface-app`, `--text-primary`, Geist, `tabular-nums` on numerics), and a `@media (prefers-reduced-motion: reduce)` block zeroing durations and freezing the scan trace (§17.3).

---

*End of Searvia design source of truth. Build against §7 gates; badge every fixture **Demo data**; keep the path alive.*





