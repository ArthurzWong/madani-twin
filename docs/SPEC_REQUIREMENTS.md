# MADANI Twin — Requirements & Acceptance Specification

> Kiro-portable format (user stories + acceptance criteria + task breakdown). Written for import into Kiro (`.kiro/specs/`) if the user enables Kiro MCP; canonical source remains this repository. Verified-implementation status is marked per group.

## R1 — Deterministic financial engine (MANDATORY) — ✅ implemented & tested

**US-1.1** As an SME owner, I want my balances computed exactly the same way every time so I can trust the forecast.
- **AC-1.1.1** All money stored as integer sen; no float arithmetic in balances or equality checks. *(tests: money round-trip, engine arithmetic)*
- **AC-1.1.2** `ClosingCash(day) = Opening + Σ signed events with expectedDate ≤ day`, closing-of-day convention, stated in UI and docs. *(test: closing formula matches spec)*
- **AC-1.1.3** Same-day events apply in a documented total order (date → inflows first → |amount| desc → id); shuffled input yields identical output. *(test: deterministic ordering)*
- **AC-1.1.4** Breach when closing cash is **strictly below** reserve; exactly-at-reserve is safe. *(test: strictly-less semantics)*
- **AC-1.1.5** Multiple breach episodes each report start/end/min balance/min day/worst shortfall/responsible events; forecasting continues through Day 30. *(test: multiple episodes, case-18)*
- **AC-1.1.6** `LeadTime = firstBreachDay − detectionDay` (calendar days) = 7 in the mandatory downside. *(test: lead time = 7)*
- **AC-1.1.7** Invalid events (bad date, non-integer amount) produce validation errors, are excluded from arithmetic, remain visible — never silently dropped; zero ≠ missing (warns). *(tests: validation)*

## R2 — Scenario simulation (MANDATORY) — ✅ implemented & tested

**US-2.1** As a finance manager, I want to test one change at a time against the untouched baseline.
- **AC-2.1.1** Ops: delay/reduce/restore receipt, increase/decrease bill, move expense, add unexpected expense, defer part of supplier payment, restore event, adjust reserve. *(Simulator UI + describeOp audit list)*
- **AC-2.1.2** Baseline is never mutated (deep-clone + op replay). *(test: scenario isolation)*
- **AC-2.1.3** A delayed receipt **moves** the original event; never creates a second receipt. *(test: moved not duplicated)*
- **AC-2.1.4** `split_postpone` splits a bill into part-now + part-later, total preserved, deferred part marked "subject to supplier agreement". *(test: no double counting; note present)*
- **AC-2.1.5** Every change recalculates balances → breaches → alerts → recommendations → full 30-day forecast and shows baseline vs revised difference.
- **AC-2.1.6** RESET SCENARIO (custom → baseline) and RESET DEMO (exact original state) exist; reset behaviour test-enforced.

## R3 — Forecasting & anomaly detection (MANDATORY) — ✅ implemented & tested

- **AC-3.1** Bill forecast: robust median (n≥4), MAD dispersion, outliers flagged (kept visible) and excluded from estimate only when n≥6 and minority; method + evidence labels; low-evidence warning when n<4; null estimate with warning when n=0. *(forecast tests)*
- **AC-3.2** Held-out evaluation when n≥6: MAE(median-of-earlier) vs MAE(last-observed) reported. *(test)*
- **AC-3.3** Duplicates: exact (ref+vendor+amount; or vendor+amount+date+normalized description) and near (vendor+amount ≤14 days apart, different refs) → review-only; legitimate repeats ≥15 days apart not flagged; cancelling one record clears the finding. *(tests)*
- **AC-3.4** Unusual charges: 3×1.4826×MAD rule with ≥4 vendor observations; otherwise absolute/percentage heuristic explicitly labelled. *(tests)*
- **AC-3.5** Every alert carries severity, category, related IDs, predicted day/date, predicted cash, reserve, shortfall, contributing transactions (signed), suggested action, evidence class, scenario-dependence. *(guardian tests + UI)*

## R4 — Explainable recommendations (MANDATORY) — ✅ implemented & tested

- **AC-4.1** Exactly three labels: APPROVE / HOLD / REVIEW; decision-support only, never payment execution.
- **AC-4.2** HOLD requires the marginal-cause test: removing the payment eliminates all breaches under the current scenario; APPROVE never based on current cash alone. *(recommend tests via suite)*
- **AC-4.3** Recommendations explain what/who/how much/when/action/what-if (action preview with recalculated minimum + remaining breaches).
- **AC-4.4** Deferred supplier schedules stay flagged until the user records agreement in Data & Assumptions; app never claims supplier consent.

## R5 — UI (MANDATORY) — ✅ implemented, browser-verified

- **AC-5.1** Six modules: Overview, Cash Ledger, Payment Guardian, What-if Simulator, Forecast & Evaluation, Data & Assumptions; first screen shows key outcome immediately.
- **AC-5.2** Ledger: search, type filter, date/amount sort, add/edit/delete with validation; confirmed vs forecast visually distinguished (status + data-class + source badges).
- **AC-5.3** Dashboard shows all brief-specified figures with as-of dates; one-click **Run MADANI Demo** (<60 s flow) + **Reset Demo**; explanatory banner on every screen.
- **AC-5.4** Baseline vs downside vs intervention trajectories in one chart with reserve line and breach shading; responsible events identified in alerts.
- **AC-5.5** Responsive desktop + mobile; risk colours red/amber/green consistent; MYR formatting.

## R6 — Evaluation & test reporting (MANDATORY) — ✅ implemented, 49/49 passing

- **AC-6.1** ≥20 reproducible synthetic cases: 24 implemented (fixed datasets, no RNG) covering the full brief list incl. inadequate-intervention later-breach and Day-30 boundary breach.
- **AC-6.2** Metrics with explicit denominators: recall, FPR (null → honest "n/a"), lead-time distribution, forecast MAE/RMSE, intervention effectiveness (eliminated? min-balance delta, breach-day delta, later-breach check).
- **AC-6.3** In-app tables show expected vs actual per case, computed live from the engine; identical numbers come from `npm test`. All labelled **synthetic**.
- **AC-6.4** Mandatory demo values preserved exactly: Baseline D7 RM25,000; Downside D7 RM5,000, shortfall RM5,000, lead 7 days; Intervention D7 RM15,000, D9 RM25,000, D30 RM25,000, no breach.

## R7 — Optional AI enhancements (OPTIONAL) — ⏸ disabled by design

- **AC-7.1** Default OFF; core works fully offline. *(this build: no AI dependency)*
- **AC-7.2** If enabled later: env-var credentials, timeouts, error handling, deterministic fallback; structured extraction requires user confirmation before import.
- **AC-7.3** AI must never: calculate authoritative balances, override breach results, auto-approve payments, mutate records without confirmation, invent confidence or business data.

## Task dependency graph (implementation order used)

```
R1 data model → R1 engine → R2 scenarios → R3 forecast/detection → R4 recommendations
     → R5 UI (uses everything above) → R6 evaluation (runs R1–R4) → R7 optional AI (skipped, seam kept)
```
