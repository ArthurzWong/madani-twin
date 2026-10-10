# MADANI Twin — Data Dictionary

All money = **integer sen** (RM 1 = 100 sen). All dates = ISO `YYYY-MM-DD`. Day index 0 = anchor date (demo: `2026-11-01`).

## LedgerEvent
| Field | Type | Meaning | Rules |
|---|---|---|---|
| `id` | string | unique ID | duplicate IDs → validation error |
| `businessId` | string | owning business/scenario | — |
| `description` | string | human label | missing → warning |
| `eventType` | enum | `receipt, payroll, supplier_payment, operating_expense, tax, loan_payment, other` | — |
| `amountSen` | integer | signed; + in / − out | NaN/non-integer → error & excluded from math; 0 → warning (zero ≠ missing) |
| `dueDate` / `expectedDate` | ISO date | bill due / engine-used date | invalid (e.g. `2026-02-30`) → error & excluded from math |
| `status` | enum | `confirmed, pending, forecasted, cancelled, corrected` | `cancelled` excluded from math |
| `vendorOrCustomer` | string | counterparty | used by duplicate/anomaly detection |
| `recurrence` | enum | `none, weekly, monthly, irregular` | — |
| `source` | enum | `user_entered, synthetic_demo, imported_history, rule_based_estimate, historical_median_forecast, scenario_assumption` | provenance |
| `dataClass` | enum | `known, user_assumption, heuristic, scenario, unknown` | UI certainty badge |
| `confidence` | number 0..1 | optional | omitted when unknown |
| `invoiceRef` | string | invoice identifier | duplicate-detection key |
| `dupMeta` | object | `normalizedDescription, amountKey, invoiceDate` | detection support |
| `note` | string | e.g. "Subject to supplier agreement" | displayed under description |
| `dayIndex` | integer | day relative to anchor | 0..horizon |

## EngineResult (per scenario)
| Field | Type | Meaning |
|---|---|---|
| `daily[]` | array | per day: `day, date, closingSen, dayNetSen, appliedEventIds[], isBreach` |
| `minBalanceSen` / `minDay` | number | lowest closing cash and its day |
| `breachEpisodes[]` | array | `startDay, endDay, minBalanceSen, minDay, maxShortfallSen, responsibleEventIds[]` |
| `firstBreachDay` | number/null | earliest breach (lead-time anchor) |
| `totalShortfallSen` | number | Σ (reserve − closing) over breach days |
| `validationIssues[]` | array | `eventId, field, severity, message` |

## RiskAlert
`id, severity(critical|warning|info), category(reserve_breach|delayed_receipt|unusual_invoice|duplicate_invoice|expense_shock|data_quality), title, explanation, relatedEventIds[], predictedDay, predictedDate, predictedCashSen, minimumReserveSen, amountBelowReserveSen, contributions[{eventId, description, amountSen}], suggestedAction, evidence(confirmed|estimated|scenario_dependent|heuristic), scenarioDependent, resolved`

## Recommendation
`eventId, description, decision(APPROVE|HOLD|REVIEW), reasons[], projectedDay, suggestedAction, actionPreview{description, newDay7CashSen?, newMinBalanceSen, breachesRemaining}`

## ScenarioOp (recorded, reversible)
`move_event{eventId,newDay}` · `change_amount{eventId,newAmountSen}` · `add_expense{description,amountSen,day,vendor?}` · `add_receipt{description,amountSen,day,customer?}` · `split_postpone{eventId,deferSen(<0),newDay}` · `restore_event{eventId}` · `set_reserve{newReserveSen}`

## BillObservation / ForecastResult
- Observation: `{id, vendor, category, amountSen, date}`
- Forecast: `{vendor, category, pointEstimateSen|null, method(insufficient_history|robust_median|robust_median_trimmed|last_observed_fallback), evidence(low|medium|high), sampleSize, outlierIds[], madSen?, lastObservedSen, heldOutMaeSen?, baselineMaeSen?, intervalSen?{low,high}, uncertaintyWarning?}`

## Persistence
`localStorage["madani-twin-state-v1"]` → `{baseline{ledger,openingCashSen,minimumReserveSen,horizonDays,anchorDate,name}, customOps[], selectedScenario, supplierAgreementConfirmed, lastUpdated}`. Scenarios are **recomputed** from baseline+ops on load (stored state can't drift); malformed data falls back to the deterministic demo.

## Evaluation metric definitions
- TP: actual breach ∧ warned · FN: breach ∧ ¬warned · FP: ¬breach ∧ warned · TN: ¬breach ∧ ¬warned
- `recall = TP/(TP+FN)` (null if denominator 0) · `FPR = FP/(FP+TN)` (null if 0)
- Lead time: first projected breach day (detection at Day 0); distribution reported, mandatory case = 7
- MAE/RMSE: over paired predictions/actuals (12-bill deterministic series)
- Intervention effectiveness: `{breachEliminated, minBalanceBefore/AfterSen, breachDaysBefore/After, laterBreachAfterIntervention}`
