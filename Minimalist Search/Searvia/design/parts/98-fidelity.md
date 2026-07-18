## 18. Fidelity rules & anti-copy constraints

This section is enforceable. If any screen, asset, or component violates a rule here, it is not done — regardless of how polished it looks. When a rule here conflicts with a visual preference, this section wins.

### 18.1 What "done right" looks like (fidelity rules)

1. **Tokens only.** Every color, size, radius, shadow, duration, and easing comes from the tokens in `00-foundation.md` §5–§6. No hard-coded hex, px shadows, or ad-hoc easing curves in components. New need → propose a token, don't inline a value.
2. **One primary accent.** Exactly one primary accent (`--accent`, electric indigo-blue) across the product. Accent means "live" or "next step." Teal is supporting only and never a CTA. If two things both want the accent, one of them is wrong.
3. **Airy by default.** Respect the spacing scale and section rhythm (§5.3). Whitespace is a feature; when in doubt, add space, not borders. Max product elevation is `--shadow-lg`.
4. **Type hierarchy is the density tool.** Achieve information density through the type scale, alignment, and tabular numerals — not through shrinking below `body-sm` in data or crowding with rules and boxes. Product UI never exceeds `h2`; oversized `display` type is marketing-only.
5. **Status = icon + text + color, always.** Never encode status, severity, or trend by color alone (WCAG 2.2). Use the exact §5.1.4 icon + label + color triplet for Critical / High / Medium / Low / Opportunity / Passed / Not checked / Manual review.
6. **AA is the floor.** All text meets WCAG 2.2 AA contrast (§5.1.5); non-text UI, icons, chart strokes, and focus rings meet ≥3:1. Keyboard focus is always visible via `--shadow-focus` and is never removed.
7. **Reduced-motion parity.** Every animation has the §6.3 reduced-motion fallback, and the interface conveys all essential meaning (progress, active waypoint, status, loaded state) with motion disabled. Motion is additive, never load-bearing.
8. **The path is a system, not a sticker.** The visibility path (§4) uses its geometry and tokens consistently; in product it stays slim (≤2px), recedes behind data, and reflects real state (idle/active/done). It never decorates or obscures evidence.
9. **Responsive at all three tiers.** Every layout is verified at desktop (≥1280), tablet (768–1279), and mobile (<768) using the §5.10 grids. No horizontal scroll except intentional data tables (which keep sticky headers/first column).
10. **Keyboard + screen-reader complete.** Full keyboard operability, logical tab order, visible focus, correct roles/labels/`aria-live` for async results and toasts, and honest empty/loading/error states for every data surface.
11. **Real, shippable SaaS.** Screens read like a live product an operator uses for eight hours — real controls, real empty states, real errors, real permissions/integration states — not a marketing mock dressed as an app.
12. **Copy is locked where locked.** Use the brand-locked strings verbatim (§18.4). Wordmark is always lowercase "searvia." Taglines, homepage headline, and product description are not paraphrased.

### 18.2 Anti-copy constraints — forbidden imagery & motifs

These are hard prohibitions. None of the following may appear in any Searvia asset, icon, illustration, hero, loader, or empty state:

- **No magnifying glass** — no lens, loupe, or "search glass" in any mark, icon, or illustration. Search is expressed via the path/URL-input origin and scan-trace, never a magnifier.
- **No moon / space / lunar / celestial concept** — no moon, crescent, craters, planets, stars, orbits, galaxies, cosmic gradients, or lunar textures (this includes not letting the radar ping-ring read as an orbit or crater).
- **No robot-brain / AI-brain imagery** — no brains, synapses, neural meshes, robot heads, humanoid AI, or "chip-with-brain" motifs. AI presence is shown via honest citation evidence, not brain iconography.
- **No excessive gradients** — no multi-stop, rainbow, mesh, or atmospheric gradients. Fills are flat; the only permitted subtlety is a single-hue tint from the accent/neutral ramps.
- **No glow blobs / bloom** — no neon glow, radial glow orbs, blurred light blobs, or aura effects. Depth comes only from the subtle elevation ramp (§5.6) and layered opacity.
- **No generic bento grid** — no trendy mosaic of mismatched rounded tiles as a layout crutch. Layouts follow the §5.10 grid with intentional hierarchy.
- **No vintage / retro styling, no decorative clutter** — no ornaments, textures, stickers, badges-for-decoration, film grain, or skeuomorphism.
- **Reference discipline:** from 21hrs.space we take only cinematic layering, framed viewport, oversized typography, scroll-driven reveals, timeline/navigation cues, and spatial depth (§2). We take none of its moon, lunar textures, mission labels, content, or exact composition.

### 18.3 Anti-copy constraints — Semrush (and any competitor) non-imitation

- **No name or brand echo.** Do not reference, evoke, or riff on Semrush's name, logo, or wordmark.
- **No color imitation.** Do not adopt Semrush's orange/competitor palettes to signal category familiarity. Searvia's palette is the §5.1 tokens only.
- **No wording imitation.** Do not copy competitor feature names, marketing phrases, issue descriptions, tooltip copy, or metric definitions. Write original Searvia copy.
- **No layout imitation.** Do not clone competitor dashboard layouts, audit report structures, widget arrangements, or navigation patterns.
- **No metric/issue-taxonomy imitation.** Do not reproduce another tool's proprietary scores, issue lists, severity thresholds, or "health score" formulas. Searvia's taxonomy (Critical/High/Medium/Low/Opportunity/Passed/Not checked/Manual review) is its own.
- **Originality test:** if an element would be recognizable as "the Semrush way of doing X," redesign it.

### 18.4 Honesty rules (non-negotiable)

1. **No fabricated data shown as live data.** Any deterministic, seeded, or example figure is visibly labeled **"Demo data"** (§5.2 caption style, with the info/flask icon) adjacent to the value or chart. Live data is only ever data actually retrieved for the user's own property.
2. **"Not checked" ≠ "Passed."** Anything not evaluated shows the **Not checked** state (muted gray + dashed-circle icon) — never the Passed green/check. Absence of a problem is not evidence of success.
3. **No guarantees.** Never claim guaranteed rankings, guaranteed AI citations, guaranteed traffic, or any outcome Searvia cannot control. Language stays evidence- and probability-based ("appears in," "as of," "based on the checks run").
4. **Integration-dependent modules are honest.** Any module that needs a connected integration or data source (e.g., AI-answer citations, analytics) shows an explicit **integration-required / connect-to-view** state with real empty-state copy — never fake numbers, placeholder charts styled as real, or "sample" values masquerading as the user's data.
5. **Timestamp and source everything.** Evidence surfaces show what was checked, when it was checked ("as of <timestamp>"), and the source. Stale data is labeled stale, not silently shown as current.
6. **No dark patterns.** No fake urgency, no manufactured issue counts to inflate severity, no hiding of the "Not checked"/"Manual review" reality to make coverage look complete. Manual-review items are surfaced honestly as needing a human.
7. **Coverage honesty.** Never imply Searvia checks something it does not, or covers a surface/engine it does not. Scope is stated plainly.

### 18.5 Locked copy (verbatim — do not paraphrase)

| Element | Locked string |
| --- | --- |
| Product name / wordmark | `searvia` (always lowercase in the wordmark; "Searvia" in sentence case in prose only) |
| Primary tagline | `Search visibility, made clear.` |
| Action tagline | `Audit. Rank. Get cited.` |
| Homepage headline | `See what is limiting your search visibility.` |
| Product description | `Searvia audits your website, tracks rankings, analyzes competitors, and shows whether your brand appears in search engines and AI-generated answers.` |

### 18.6 Pre-ship fidelity checklist

- [ ] Only tokens used (no inline hex/px/easing); one primary accent respected.
- [ ] All status via icon + text + color; no color-only encoding.
- [ ] WCAG 2.2 AA text contrast + ≥3:1 non-text; visible focus everywhere.
- [ ] Reduced-motion fallback present; meaning survives motion-off.
- [ ] Verified at ≥1280 / 768–1279 / <768; no unintended horizontal scroll.
- [ ] Keyboard + screen-reader complete; honest empty/loading/error states.
- [ ] No forbidden imagery (magnifier, moon/space, brain, glow, heavy gradients, bento, vintage).
- [ ] No Semrush/competitor name, color, wording, layout, or taxonomy echo.
- [ ] All example figures labeled "Demo data"; "Not checked" never shown as "Passed."
- [ ] Integration-dependent modules show honest integration-required state (no fake numbers).
- [ ] Locked copy used verbatim; wordmark lowercase.
- [ ] Visibility path stays slim/receding in product and reflects real state.
