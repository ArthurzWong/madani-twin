# MADANI Twin — 2-Minute Technical Explainer for Judges

**The problem.** A Malaysian SME can look solvent today and still hit its cash floor next week when a customer pays late. Spreadsheets show today's balance; they don't warn you *early*, tell you *which transaction* causes the shortfall, or let you *test a fix* against the full 30-day horizon.

**The product.** MADANI Twin is a decision-support engine with six modules — Overview, Cash Ledger, Payment Guardian, What-if Simulator, Forecast & Evaluation, Data & Assumptions — all powered by **one deterministic, pure-function engine**. Same inputs → same numbers, every time, offline.

**Three things to verify in 60 seconds:**

1. **The mandatory scenario.** Day 0: RM50,000 cash, RM10,000 reserve. Receipt +RM20,000 (Day 5), payroll −RM25,000 and supplier −RM20,000 (Day 7). Move the receipt to Day 9 → the engine projects Day-7 closing cash of **RM5,000 — RM5,000 below reserve**, flagged on **Day 0: a 7-day warning**. Apply the intervention (defer RM10,000 of the supplier bill to Day 9, *subject to supplier agreement*) → Day 7 = **RM15,000**, Day 9 = **RM25,000**, Day 30 = **RM25,000**, zero breaches. Every figure is recomputed by `runEngine` — nothing in the UI is hardcoded; the same numbers appear in the Vitest suite, the in-app evaluation tables and the charts.

2. **Explainability.** Open Payment Guardian: each alert states severity, evidence class, the exact contributing transactions with signed amounts, the predicted date, projected cash and shortfall, plus a suggested action. Recommendations use exactly three labels — **APPROVE / HOLD / REVIEW** — and a payment is never APPROVE merely because today's cash is enough: the engine simulates removing the payment to test whether it is the *marginal cause* of the breach, and offers a one-click testable preview of the fix.

3. **Honest evaluation.** The Forecast & Evaluation tab runs **24 reproducible synthetic cases** and **31 acceptance checks** against the real engine at page load, showing expected vs actual per case. Recall, false-positive rate (with explicit denominators and honest "n/a" on empty ones), lead-time distribution, forecast MAE/RMSE and intervention effectiveness are all computed live — and labelled synthetic throughout.

**Under the hood.** Integer-sen arithmetic (no float money); closing-of-day balances with deterministic same-day ordering; breach = closing cash *strictly* below reserve, with multi-episode reporting; scenarios are recorded as reversible ops over an **immutable baseline** (a delayed receipt is *moved*, never duplicated; a deferred bill is *split* without double counting). Bill forecasting uses a documented robust median + MAD method with outlier flagging (flagged, never deleted), low-evidence labelling when history is thin, and held-out median-vs-last comparison. Duplicate detection separates exact matches from near-duplicates and never treats vendor+amount repetition as proof of fraud. State persists in validated localStorage; Reset Demo restores the exact original test state.

**What we are not claiming:** no real-world predictive accuracy (synthetic data only), no bank integrations, no hidden LLM in the calculation path — every number is deterministic and reproducible.
