# MADANI Twin — Architecture

## Layers

```
┌────────────────────────────────────────────────────────────┐
│ UI (React 18, TypeScript)                                  │
│ App.tsx → Overview / Ledger / Guardian / Simulator /       │
│           Evaluation / Assumptions (6 modules)             │
│ components/TrajectoryChart.tsx (dependency-free SVG)       │
│ components/ui.tsx (badges, cards, stats)                   │
├────────────────────────────────────────────────────────────┤
│ State (src/state/appState.ts)                              │
│  • single store; recompute-everything on change            │
│  • localStorage persistence w/ validation + recovery       │
│  • scenario switch: baseline/downside/intervention/custom  │
├────────────────────────────────────────────────────────────┤
│ Engine (src/engine/*) — PURE, DETERMINISTIC, UI-FREE       │
│  types.ts       money.ts      core.ts       scenarios.ts   │
│  forecast.ts    guardian.ts   recommend.ts  evaluation.ts │
│  syntheticCases.ts  suite.ts  demoScenario.ts              │
├────────────────────────────────────────────────────────────┤
│ Tests (Vitest)                                             │
│  tests/engine.test.ts (45)  tests/ui.test.tsx (4, jsdom)   │
└────────────────────────────────────────────────────────────┘
```

**Dependency rule:** UI → State → Engine. The engine imports nothing from UI/state and performs no I/O — it is fully unit-testable in Node and shared by the app, the in-app evaluation panel, and the test suite (one source of truth).

## Data flow (every change)

```
user edit / what-if op
  → appState (clone scenario ledger, apply ops)
  → runEngine (validate → deterministic sort → daily closing balances
               → breach episodes → minima → shortfall → lead time)
  → classifyRisk (breach, delayed receipt, duplicates, unusual charges, data quality)
  → recommendAction (APPROVE / HOLD / REVIEW + action previews via probe scenarios)
  → UI re-renders dashboard, chart, tables (same numbers, same engine)
```

## Engine invariants (all test-enforced)

1. **Integer-sen arithmetic.** No floats in money; `formatMYR/parseMYRToSen` handle RM strings.
2. **Closing-of-day balances.** `Closing(day) = Opening + Σ signed events with expectedDate ≤ day` (valid, non-cancelled, within horizon). Stated in UI footer and docs.
3. **Deterministic ordering.** date → inflows-before-outflows → |amount| desc → id. Verified by shuffled-input test.
4. **Strict breach semantics.** `closing < reserve` (exactly-at-reserve is safe). Verified.
5. **Multi-episode breaches.** Contiguous runs each with min balance, shortfall, responsible events. Verified (case-18).
6. **Lead time.** `calculateLeadTime(detectionDay=0, firstBreachDay)` = 7 in the mandatory downside. Verified.
7. **Scenario isolation.** Baseline deep-cloned per run; ops (move/split/restore) never mutate it. Verified.
8. **No fabricated receipts.** A moved receipt is moved, not duplicated; deferred bills are split without double-counting. Verified.

## Forecasting & detection (docs/engine.md has full method)

- **Bill forecast:** robust median + MAD; outliers flagged (never deleted) and trimmed from estimate when n≥6; evidence labelling (low/medium/high); held-out MAE(median) vs MAE(last-observed).
- **Duplicates:** exact (ref/vendor/amount or vendor+amount+date+normalized desc) and near (vendor+amount within 14 days, different refs → review-only).
- **Unusual charges:** 3×1.4826×MAD robust rule with ≥4 observations; otherwise labelled rule-based heuristic.
- **Recommendations:** HOLD only when simulating the payment's removal eliminates all breaches (marginal-cause test); REVIEW on data-quality/duplicate/anomaly linkage; APPROVE otherwise, with trajectory-based reasons and one-click action previews.

## Persistence & recovery

`localStorage["madani-twin-state-v1"]` stores baseline + recorded ops + selection + supplier-agreement flag. Load validates structure and **recomputes all scenarios from baseline + ops**; malformed state falls back to the deterministic demo. Reset removes the key.

## Extensibility seams

- `recommend.ts`/`guardian.ts` keep explanation-building separated from calculation — an optional LLM could rephrase existing findings without ever touching balances.
- `ScenarioOp` union is the single extension point for new what-if operations.
- Business-type templates only supply example ledgers; the engine is shared (per brief).
