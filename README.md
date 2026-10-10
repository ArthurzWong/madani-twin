# MADANI Twin — SME Cash-Flow Decision Engine

**Dormathon 2026 · Track 1 — Predict Early, Decide Better**

MADANI Twin answers five questions for Malaysian SMEs from one deterministic engine:

1. How much cash is available now?
2. When could cash fall below the minimum safe reserve?
3. Which transactions cause the predicted shortfall?
4. What practical intervention could reduce the risk?
5. Does that intervention hold for the complete 30-day forecast?

> The app ships with an **illustrative synthetic SME scenario** — clearly labelled in the UI. It is not real company financial data.

---

## Quick start

```bash
npm install     # Node 18+ (built with Node 22)
npm run dev     # dev server → http://localhost:5173
```

Production build & tests:

```bash
npm run build   # → dist/
npm run preview # serve the production build
npm test        # Vitest: 49 automated tests
```

The demo works fully offline — no API keys, no database, no external services.

## The 60-second demo

1. Open the app → **▶ Run MADANI Demo** (loads automatically on first visit too).
2. The app opens on the **Downside** scenario. You immediately see: Day-7 projected cash **RM5,000** — **RM5,000 below** the RM10,000 reserve, with **7 days of warning** from Day 0.
3. Toggle **Baseline / Downside / Intervention** to compare all three trajectories in one chart.
4. Open **Payment Guardian** → each alert explains the responsible transactions, dates, amounts, and a suggested action with APPROVE / HOLD / REVIEW labels.
5. Open **What-if Simulator** → apply one change (delay a receipt, defer RM10,000 of the supplier bill…) and watch the full 30-day forecast recalculate.
6. Open **Forecast & Evaluation** → the live test battery (24 synthetic cases + 31 acceptance checks) runs against the real engine at page load.
7. **↺ Reset Demo** restores the exact original state at any time.

## Mandatory scenario (reproducible)

Anchor date fixed at **2026-11-01**; Day 0 opening cash **RM50,000**, reserve **RM10,000**.

| Day | Event | Amount |
|-----|-------|--------|
| 5   | Customer receipt — Gopeng Trading (INV-2041) | +RM20,000 |
| 7   | Payroll (9 staff) | −RM25,000 |
| 7   | Supplier payment — Syarikat Bekalan Utama (SBU-8817) | −RM20,000 |

**Engine-verified results** (identical to the spec):

| Check | Result |
|-------|--------|
| Baseline Day 7 cash | RM25,000 · no breach · min RM25,000 |
| Downside (receipt Day 5→9) Day 7 cash | RM5,000 · breach RM5,000 below reserve |
| Warning lead time | 7 days (detected Day 0, breach Day 7) |
| Intervention (defer RM10,000 supplier → Day 9) Day 7 cash | RM15,000 · no breach |
| Intervention Day 9 / Day 30 cash | RM25,000 / RM25,000 · no breach |

The downside **moves** the original receipt (never duplicates it); the intervention **splits** the supplier bill into RM10,000 (Day 7) + RM10,000 (Day 9, marked *subject to supplier agreement*) with no double counting.

## Architecture

```
src/
  engine/            ← pure, deterministic, UI-free (fully unit-tested)
    types.ts         ← integer-sen money model, ledger, alerts, scenarios
    money.ts         ← MYR formatting/parsing, ISO date math, validation
    core.ts          ← runEngine: daily balances, breach episodes, lead time
    scenarios.ts     ← scenario ops (move/split/restore…) over an immutable baseline
    forecast.ts      ← robust median + MAD bill forecasting, held-out eval, MAE/RMSE
    guardian.ts      ← duplicate & unusual-charge detection, classifyRisk alerts
    recommend.ts     ← APPROVE/HOLD/REVIEW with testable action previews
    evaluation.ts    ← recall/FPR/lead-time/intervention-effectiveness metrics
    syntheticCases.ts← 24 reproducible synthetic test cases
    suite.ts         ← 31 acceptance checks incl. the mandatory arithmetic
  state/appState.ts  ← single store: recompute-everything + localStorage persistence
  components/        ← dependency-free SVG trajectory chart + UI primitives
  App.tsx            ← six modules: Overview, Ledger, Guardian, Simulator, Evaluation, Assumptions
tests/               ← 45 engine tests + 4 UI render smoke tests (Vitest + jsdom)
```

**Key decisions**

- **Integer sen everywhere** — no floating-point money; `formatMYR` renders RM with tabular numerals.
- **Closing-of-day balances**: `ClosingCash(day) = OpeningCash + Σ signed events with date ≤ day`; breach = closing **strictly below** reserve.
- **Deterministic ordering**: by date → inflows before outflows → larger magnitude first → id, so same-day events always apply identically.
- **Baseline immutability**: scenarios deep-clone the baseline ledger; ops (move/split/restore) never mutate the source. Verified by test.
- **One engine, one truth**: the dashboard, alerts, recommendations, charts, the in-app evaluation tables and the Vitest suites all call the same pure functions.

## Documentation

- [Data schema](docs/data-schema.md) — ledger event, alerts, scenario ops, persistence
- [Financial engine](docs/engine.md) — formulas, forecasting method, detection rules
- [Test report](docs/test-report.md) — actual results from the last full run
- [Judge's technical explainer](docs/judge-explainer.md) — 2-minute walkthrough
- [Sample dataset](data/sample-dataset.json) — the mandatory scenario, machine-readable

## Known limitations & honest disclosures

- All data is **synthetic**; no claim of real-world predictive accuracy is made. Evaluation metrics are computed from reproducible synthetic cases only.
- Bill forecasts with <4 observations are labelled **low-evidence** with an explicit warning rather than a fabricated confidence interval.
- The intervention's Day-9 deferral is **conditional** — the app never claims the supplier agreed unless the user records it (Data & Assumptions → checkbox).
- Duplicate detection flags for review; vendor+amount repetition alone is never treated as proof of fraud.
- Browser-storage persistence is validated on load; malformed state falls back to the clean deterministic demo.
- Optional LLM integration was deliberately **not** included in this build: every calculation is deterministic and offline, which matches the track's emphasis on reproducibility. (The architecture keeps a clean seam in `recommend.ts`/`guardian.ts` where an explanation-only assistant could attach without touching balances.)
