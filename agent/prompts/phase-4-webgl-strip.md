You are continuing work on Scholara, an offline-first Tauri + React + TypeScript desktop reading app.

Project root: /Users/creekrichmond/Documents/projects/scholara

Read first:
- Hard constraints: CLAUDE.md lines 9–20
- Library right-panel spec: CLAUDE.md lines 46–51 and .claude/scholara-prompt.md lines 50–66
- Originally-deferred features now in scope: CLAUDE.md lines 85–88
- Brain-animation product detail: .claude/scholara-product-spec.md (search "Brain animation" / "pink dot particles" — describes hover behavior in more detail than CLAUDE.md)
- Visual inspo: .claude/inspo/
- Foundation spec §8.8 (the BrainPlaceholder and ScrollStripPlaceholder you replace): docs/superpowers/specs/2026-05-04-foundation-design.md
- Reader and AI specs (for understanding what data flows into the strip): docs/superpowers/specs/<reader-date>-reader-design.md, docs/superpowers/specs/<ai-date>-ai-design.md

You are starting **Phase 4: WebGL brain animation + circularly scrolling vocab/notes/quotes strip + Global Dictionary & Notes modal**.

Scope:
1. Replace src/screens/Library/BrainPlaceholder.tsx body with a particle-based brain animation — pink dots loosely forming a brain shape with ambient drift, cursor-hover lights up nearby particles with a gradient. Light/scholarly/exciting (not gimmicky). Must respect prefers-reduced-motion.
2. Replace src/screens/Library/ScrollStripPlaceholder.tsx body with a circularly scrolling strip looping vocabulary words (with definitions), saved quotes, and notes — recency-ordered, continuous, pausable on hover. Sources: vocabulary table (Phase 3) and notes table (Phase 2).
3. Build the Global Dictionary & Notes modal (opened by clicking the strip): Dictionary tab (all vocab across all books) + Notes & Quotes tab (organized per book).

Open decisions for brainstorming:
- Animation tech for the brain — Three.js (familiar, heavy bundle) vs. raw WebGL shaders (lean, more code) vs. 2D canvas with a few-hundred-dot approximation (smallest, may be enough). Tauri prefers small bundles.
- Brain point-cloud source — procedural sampling of a low-poly mesh vs. a hand-curated point cloud asset (where stored, how licensed).
- Strip implementation — CSS marquee with duplicated content vs. framer-motion infinite loop. Perf with hundreds of items.
- Global modal — single shadcn Dialog with internal Tabs vs. Sheet. Affects dismiss UX.

Inherited contracts (do not change without approval):
- File names and export names of BrainPlaceholder and ScrollStripPlaceholder — replace bodies, preserve filenames and exports.
- The Library layout grid in src/screens/Library/index.tsx — fill into the existing right column.
- vocabulary and notes table schemas.

Use today's date for the YYYY-MM-DD filename prefix.

Run the brainstorming skill, then writing-plans. Save outputs to:
- docs/superpowers/specs/<today>-webgl-strip-design.md
- docs/superpowers/plans/<today>-webgl-strip-implementation.md

Do not write application code in this session — spec + plan only.
