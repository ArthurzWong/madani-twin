# MADANI Twin — Test Report

**Run date:** 2026-10-11 (Asia/Kuala_Lumpur) · **Runner:** Vitest 2.1.8 · **Environment:** Node v26.4.0, macOS arm64

## Summary

| Suite | Passed | Failed | Skipped |
|-------|-------:|-------:|--------:|
| `tests/engine.test.ts` (engine + acceptance) | 45 | 0 | 0 |
| `tests/ui.test.tsx` (UI smoke, jsdom) | 4 | 0 | 0 |
| **Total** | **49** | **0** | **0** |

In-app suites (computed at page load by the same functions):

| In-app battery | Result |
|---|---|
| Synthetic case battery (`runSyntheticCases`) | **24/24 PASS** |
| Acceptance check suite (`runFullSuite`) | **31/31 PASS** |

## What the engine tests cover (highlights)

- **Mandatory arithmetic:** Baseline D7 = RM25,000 (no breach); Downside D7 = RM5,000 with RM5,000 shortfall; lead time = 7 days; Intervention D7 = RM15,000, D9 = RM25,000, D30 = RM25,000 with zero breaches; receipt **moved not duplicated**; supplier bill split **without double counting**; deferred part carries the supplier-agreement note.
- **Engine mechanics:** closing-of-day formula; deterministic same-day ordering (inflows first, id tiebreak); multiple breach episodes; strictly-less breach semantics; scenario isolation (baseline unmutated); reset equals pristine baseline.
- **Validation:** invalid dates (`2026-02-30`) and non-integer amounts reported as errors and excluded from math while retained in the ledger; zero vs missing; duplicate IDs; MYR parse/format round-trips.
- **Duplicates & anomalies:** exact duplicates caught; legitimate repeats (30 days apart) *not* flagged; near-duplicates (3 days apart, different refs) flagged for review; cancelling a record clears the finding; robust 3-MAD unusual-charge detection with vendor history; normal invoices not flagged.
- **Forecasting:** median/MAD; low-evidence labelling (n=2 → `insufficient_history`); outlier flagged & trimmed (n≥6) with estimate RM5,000; held-out median-vs-last comparison; MAE/RMSE math; deterministic pair generation.
- **Metrics:** zero-denominator honesty (`null`), recall/FPR math, detection counts over the synthetic battery, intervention-effectiveness on the mandatory scenarios.
- **Synthetic battery:** 24 reproducible cases (fixed events, no RNG) — all passing, deterministic across runs.
- **UI smoke:** app mounts showing the mandatory figures; scenario switch renders intervention values; evaluation tab renders both live batteries (24/24 and 31/31); Run Demo restores the exact original state.

## Reproduce

```bash
npm install
npm test          # → 2 files, 49 tests, all passing
npm run dev       # → open Forecast & Evaluation tab to see live in-app results
```

## Issues found & fixed during the run (transparent log)

1. `split_postpone` sign error produced wrong pay-now part → fixed (`payNow = amount − deferSen`); tests then verified no double counting.
2. Non-integer/NaN amounts were not excluded from balance math → engine now excludes invalid events from arithmetic while keeping them visible with validation errors.
3. Suite checked `reset.ledger.length === fresh.ledger.length` on a mutated probe object → replaced with absolute expectations (3 events, min RM25,000).
4. Two synthetic cases (case-05, case-22) had spec-writing arithmetic mistakes in *expected* values → recomputed and corrected; case-02 redesigned so a 1-day receipt delay genuinely produces the breach under closing-of-day semantics; case-13 opening cash raised to RM60,000 so the anomaly case tests the detector, not the reserve.
5. Test file referenced a stale `calculateLeadTime` import path and two stale magnitude expectations → fixed.
