# MADANI Twin — Design Decisions & Rationale

| # | Decision | Alternatives considered | Why this way |
|---|---|---|---|
| 1 | **Integer-sen money everywhere** | Float RM, decimal library | Float equality fails on money; decimal libs add deps. Integer sen is exact, fast, spec-compliant ("use integer sen or decimal-safe"). |
| 2 | **Pure-function engine, UI-free** | Logic in components, redux-thunk style | The brief demands the same engine drive dashboard, alerts, charts *and tests*. Pure functions make the in-app evaluation tables and Vitest run the exact same code. |
| 3 | **Scenarios as recorded ops over an immutable baseline** | Forking ledgers, direct mutation | Ops (move/split/restore…) are auditable, reversible, reproducible, and serialize to localStorage trivially. Mutation is the root cause of "demo state drift". |
| 4 | **`split_postpone` as first-class op** | Change amount + add new bill manually | Guarantees no double-counting and auto-attaches "subject to supplier agreement" — the brief's conditional-intervention semantics can't be mis-modelled by users. |
| 5 | **Closing-of-day balance convention** | Opening-of-day, intraday min | Spec pins closing-of-day; intraday ordering (inflows first) is deterministic but reported without mixing conventions. Documented in UI footer. |
| 6 | **Strict `<` breach** | `<=` | Spec: "A breach exists when closing cash is strictly less than the minimum reserve." Exactly-at-reserve is safe (test-verified). |
| 7 | **Marginal-cause HOLD test** (remove payment → no breaches ⇒ HOLD) | Rule-of-thumb thresholds, current-cash check | Produces explainable, scenario-specific recommendations and never APPROVEs on current cash alone, per brief. |
| 8 | **Robust median + MAD forecasting; outliers flagged not deleted** | Mean-based, ML models | Robust to exactly the data SMEs have: few, irregular, extreme bills. Flagging keeps humans in the loop; trimming only with n≥6 avoids over-deletion. |
| 9 | **Honest metric denominators** (`null` → "n/a") | Show 0% or fake numbers | Zero-denominator honesty is a hard brief requirement; test-enforced. |
| 10 | **24 fixed synthetic cases (no RNG)** | Seeded random generator | Fixed datasets are easier for judges to audit and reproduce; seed-based generation was rejected for auditability. |
| 11 | **AI layer omitted, seam preserved** | Wire an LLM for explanations | Track prizes determinism + offline reliability. The brief makes AI optional; `recommend.ts` already separates explanation-building from calculation so an optional layer can attach later without touching balances. |
| 12 | **Dependency-free SVG chart** | recharts/chart.js | One chart type needed (trajectory + reserve line + breach shading); zero-dep keeps bundle at 72 KB gzip and the chart fully engine-driven. |
| 13 | **Anchor date fixed at 2026-11-01 for the demo** | Always "today" | Reproducibility: every demo run, screenshot and test shows identical dates. |
| 14 | **localStorage with recompute-on-load** | Server DB, IndexedDB | Zero-backend requirement; recomputing from baseline+ops means stored state can't drift from engine logic and corrupt data self-heals. |
| 15 | **Kiro/Mobbin/Grafilab documented as unavailable** | Pretend integrations worked | The blueprint explicitly forbids invented connectors; `TOOL_INTEGRATION_MATRIX.md` records the verification receipts. |
