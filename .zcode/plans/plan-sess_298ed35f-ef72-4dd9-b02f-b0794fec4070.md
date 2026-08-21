# Make TrueModel's detection results more detailed and more accurate

Goal: sharpen the identity engine and enrich what the user sees per model — inspired by APIMaster's behavioral-fingerprinting approach, but keeping your honest, cohort-relative, no-database architecture. Everything below is client-side logic with at most **1 extra request per model**; no backend or DB changes.

## Part 1 — Accuracy: new & stronger signals

### 1.1 Expand the identity probe battery (5 → 8 items) in `lib/identity.ts`
The current probe includes the famous "strawberry" letter-count — 2026-era models were specifically tuned on it, so it's losing discriminative power. Add three harder items with deterministic checkers (reusing `extractAnswer`'s markdown-tolerant parsing):
- **Nonce-word letter count** — e.g. r's in "retrospectrometer" (deterministic, not in fine-tuning sets)
- **Harder arithmetic** — e.g. 847 × 36 (separates tiers better than 17 × 24)
- **Constrained format** — "Reply with exactly seven words" (graded by word count; stronger instruction-following test than single-word ORANGE)

### 1.2 Knowledge-cutoff signal (new, soft weight)
Training cutoff is one of the most robust generational discriminators (Sonnet 4.5 vs Sonnet 5 genuinely differ).
- `lib/registry.ts`: add approximate `cutoffFrom`/`cutoffTo` month windows to every family (~60 entries); bump `REGISTRY_VERSION`
- New small probe: 4–6 short dated-knowledge questions with stable factual answers, batched into **one** request per model (same pattern as the existing 5-item probe)
- Grading: correctly answering questions dated *after* the advertised cutoff window = "knows too much" → newer generation → fail; failing questions comfortably *inside* the window = older generation → fail; unknown id or missing cutoff data → record as evidence, don't score ("skip, don't guess", consistent with existing design)

### 1.3 Stylometry signal (new, soft weight, **zero extra requests**)
Computed from probe answers already collected. New `lib/stylometry.ts`: extract per-model style features (avg sentence length, markdown/bold/list density, em-dash rate, ellipsis rate, exclamation rate, refusal-phrase patterns, opener patterns), compare each model's feature vector against the cohort median via divergence — same pattern as the random-number fingerprint, including the cohort-learned threshold. A swapped model writes differently from its siblings on the same endpoint.

### 1.4 Per-run pass-rate grading for puzzles
Currently 3 runs at temperature 0 produce near-identical answers, so one fluke fails a model. Grade each puzzle per-run, record pass rates (e.g. 2/3), require majority for pass, minority = `partial` (status already exists in `CheckStatus`). Show per-item rates in the evidence detail ("arithmetic: 3/3 runs").

## Part 2 — Detail: richer result presentation

### 2.1 Ranked "closest families" attribution in `lib/attribution.ts`
Replace the flat `candidateFamilies` (ceiling-matched only) with a scored ranking across registry families: composite of output-ceiling match, vendor consistency, puzzle capability profile, tokenizer cohort agreement, cutoff estimate. Show top-3 with match percentages in the attribution section — directly answers "if this isn't Opus 5, what am I actually getting?"

### 2.2 Confidence breakdown in the UI (`components/ModelTable.tsx`, `IdentityPill.tsx`)
The 0–100 confidence already exists internally — surface it as a bar on the verdict pill plus an expandable "what moved the needle" list showing each signal's weight × outcome contribution to the verdict.

### 2.3 Raw measurements in the evidence panel
- Tokenizer: measured count vs cohort median as a mini comparison bar
- Random fingerprint (deep mode): small distribution histogram vs cohort baseline
- Ceiling: measured cap vs registry expectation

## Part 3 — Supporting work
- `lib/receipt.ts`: include new signals, per-item pass rates, candidate ranking in evidence receipts
- `app/how-it-works/page.tsx`: document the three new signals with the same honest epistemics (what each can and cannot prove)
- Tests (Vitest): unit tests for all new checkers, cutoff grading, stylometry divergence, and ranked attribution; update existing `identity.test.ts` / `attribution` tests
- Update `README.md` feature list

## Execution order
1. Registry cutoff data + expanded probe battery + checkers (with tests) — pure engine work, no UI risk
2. Cutoff + stylometry signals wired into `verifyModelIdentity` and the cohort flow in `app/page.tsx`
3. Ranked attribution + confidence breakdown + raw-measurement UI
4. Receipts, how-it-works page, README