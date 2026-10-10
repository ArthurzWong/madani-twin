# MADANI Twin — Financial Engine Documentation

## 1. Money representation

All arithmetic uses **integer sen**. Parsing (`parseMYRToSen`) accepts `RM1,234.50`, `1234.5`, `-500` and rejects non-numeric or over-precise input. Formatting (`formatMYR`) renders `RM` with `en-MY` grouping. No floating-point values ever participate in balance arithmetic or equality checks.

## 2. Balance model

```
ClosingCash(day) = OpeningCash + Σ amountSen of all events with expectedDate ≤ day
                   (status ≠ cancelled, valid integer amount, valid date, 0 ≤ day ≤ horizon)
```

- Balances are **closing-of-day** values: all same-day events are applied before the close. This is stated in the UI footer and in the Overview.
- Same-day application order is deterministic: date → inflows before outflows → larger |amount| first → id (total order; verified by test that shuffled input produces identical output).
- **Breach** = `ClosingCash(day) < minimumReserveSen` (strictly less; exactly-at-reserve is not a breach — verified by test).
- Multiple **breach episodes** are reported (contiguous runs), each with its minimum balance, worst shortfall and responsible events (the `appliedEventIds` on the minimum day).
- `totalShortfallSen` = Σ over breach days of `(reserve − closing)`.
- `calculateLeadTime(detectionDay, breachDay)` = breach − detection. In the mandatory demo, detection is Day 0 and the breach is Day 7 → **lead time 7 days**.

## 3. Scenario engine

`runScenario(baseline, …ops)` deep-clones the baseline ledger, then applies ops in order:

- `move_event` — **moves** the original event (a delayed receipt is never duplicated as a second receipt).
- `split_postpone` — splits a bill: pay-now part = original − deferred; a second event carries the deferred amount with note *"Subject to supplier agreement"*. No double counting (total outflow preserved; verified by test).
- `change_amount`, `add_expense`, `add_receipt`, `set_reserve` — explicit and recorded.
- `restore_event` — removes the event and any `-defer` derivatives, re-cloning the pristine baseline row.

The baseline object is never mutated (verified by test). Every scenario recomputes the full 30-day trajectory, minima, episodes, alerts and recommendations.

## 4. Bill forecasting (`forecastRecurringBill`)

Grouped by **vendor + category** on historical observations.

| n observations | behaviour |
|---|---|
| 0 | `pointEstimate = null`, explicit "no history" warning |
| 1–3 | median of what exists; `method = insufficient_history`, `evidence = low`, warning shown |
| ≥ 4 | robust **median** + **MAD** dispersion; outliers flagged when |x − median| > 3 × 1.4826 × MAD |
| ≥ 6 with outliers | outliers **flagged, never deleted**; excluded from the estimate (`robust_median_trimmed`) when they are a minority; MAD-derived interval shown |
| ≥ 6 | **held-out evaluation**: last observation predicted from earlier ones; MAE(median) vs MAE(last-observed) baseline reported |

Irregular intervals, gaps and extreme values are supported by design (median/MAD are robust); missing history is labelled rather than invented.

## 5. Payment Guardian

**Duplicates** (`detectDuplicateInvoices`) — three passes:
1. exact: same invoiceRef + vendor + amount;
2. exact: same vendor + amount + date + normalized description;
3. near: same vendor + amount within 14 days with different refs → REVIEW flag.

Repeated vendor+amount alone (≥15 days apart / distinct refs) is **not** flagged — verified by test. Cancelling one record clears the finding (verified).

**Unusual charges** (`detectUnusualCharges`) — with ≥4 vendor observations: documented robust threshold `median + 3 × 1.4826 × MAD` (`robust_statistical`); otherwise absolute/percentage heuristic, labelled `rule_based_heuristic` in the alert.

**classifyRisk** emits alerts per breach episode, per delayed receipt (vs baseline), per duplicate finding, per unusual charge, and one aggregated data-quality alert for validation errors. Every alert carries severity, evidence class, predicted day/date/cash, shortfall, contributing transactions with signed amounts, and a suggested action.

## 6. Recommendations (APPROVE / HOLD / REVIEW)

For each outgoing payment:
- linked duplicate/unusual/data-quality alert → **REVIEW**;
- simulating the payment removed eliminates *all* breaches → the payment is the marginal cause → **HOLD**, with reasons (which day, how far below reserve) and a **testable preview** (e.g. "defer RM10,000 → projected minimum RM15,000, 0 breaches");
- otherwise **APPROVE** with trajectory-based reasoning (minimum stays above reserve through Day 30).

Current cash sufficiency alone never produces APPROVE. Deferred supplier schedules remain flagged until the user records agreement in *Data & Assumptions*.

## 7. Evaluation metrics

- **Detection** over the 24 synthetic cases: TP = actual breach + warned; FN = breach without warning; FP = warning without breach; TN = neither. `recall = TP/(TP+FN)`, `FPR = FP/(FP+TN)`; zero denominators return `null` and the UI says "n/a" (verified by test).
- **Lead time** distribution across detected breach cases (min/avg/max shown; mandatory case contributes exactly 7).
- **Forecast MAE/RMSE** from a deterministic 12-bill series (`generateForecastPairs`).
- **Intervention effectiveness**: breach eliminated?, minimum balance before/after, breach days before/after, any later breach in the horizon.
- All figures displayed in-app are computed at page load by the same functions the Vitest suite tests; results are labelled synthetic throughout.
