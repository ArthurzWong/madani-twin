# MADANI Twin — Data Schema

All monetary values are **integer sen** (1 RM = 100 sen). Dates are ISO `YYYY-MM-DD`. Day indices are relative to the scenario anchor date (demo: `2026-11-01`).

## LedgerEvent

```ts
interface LedgerEvent {
  id: string;                    // unique, stable across scenario copies
  businessId: string;            // business or scenario id
  description: string;
  eventType: "receipt" | "payroll" | "supplier_payment"
           | "operating_expense" | "tax" | "loan_payment" | "other";
  amountSen: number;             // signed: + in, − out; MUST be integer
  dueDate: string;               // ISO
  expectedDate: string;          // ISO — date used by the engine
  status: "confirmed" | "pending" | "forecasted" | "cancelled" | "corrected";
  vendorOrCustomer: string;
  recurrence: "none" | "weekly" | "monthly" | "irregular";
  source: "user_entered" | "synthetic_demo" | "imported_history"
        | "rule_based_estimate" | "historical_median_forecast" | "scenario_assumption";
  dataClass: "known" | "user_assumption" | "heuristic" | "scenario" | "unknown";
  confidence?: number;           // 0..1, omitted when unknown
  invoiceRef?: string;           // used by duplicate detection
  dupMeta?: { normalizedDescription: string; amountKey: string; invoiceDate: string };
  note?: string;                 // e.g. "Subject to supplier agreement"
  dayIndex?: number;             // day relative to anchor
}
```

Rules enforced by `validateLedger` (never silently drops events):

- non-integer or NaN `amountSen` → **error**; event excluded from arithmetic, retained in ledger and reported in the UI;
- zero amount → **warning** (zero ≠ missing);
- invalid ISO date (e.g. `2026-02-30`) → **error**; event excluded from arithmetic;
- missing description → warning; duplicate ids → error.

## EngineResult (per scenario)

```ts
interface EngineResult {
  openingCashSen: number; minimumReserveSen: number; horizonDays: number;
  daily: Array<{ day: number; date: string; closingSen: number; dayNetSen: number;
                 appliedEventIds: string[]; isBreach: boolean }>;
  minBalanceSen: number; minDay: number;
  breachEpisodes: Array<{ startDay: number; endDay: number; minBalanceSen: number;
                          minDay: number; maxShortfallSen: number; responsibleEventIds: string[] }>;
  firstBreachDay: number | null;
  totalShortfallSen: number;     // Σ daily (reserve − closing) over breach days
  validationIssues: ValidationIssue[];
}
```

`closingSen` is **closing-of-day** (all same-day events applied). Breach: `closingSen < minimumReserveSen` (strict).

## ScenarioOp

```ts
type ScenarioOp =
  | { kind: "move_event"; eventId: string; newDay: number }
  | { kind: "change_amount"; eventId: string; newAmountSen: number }
  | { kind: "add_expense"; description: string; amountSen: number; day: number; vendor?: string }
  | { kind: "add_receipt"; description: string; amountSen: number; day: number; customer?: string }
  | { kind: "split_postpone"; eventId: string; deferSen: number; newDay: number }  // deferSen negative
  | { kind: "restore_event"; eventId: string }
  | { kind: "set_reserve"; newReserveSen: number };
```

Scenarios are recorded as op lists and re-applied on every load → **reproducible**. The baseline ledger is deep-cloned per run; ops never mutate it.

## RiskAlert

```ts
interface RiskAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  category: "reserve_breach" | "delayed_receipt" | "unusual_invoice"
          | "duplicate_invoice" | "expense_shock" | "data_quality";
  title: string; explanation: string;
  relatedEventIds: string[];
  predictedDay: number | null; predictedDate: string | null;
  predictedCashSen: number | null; minimumReserveSen: number;
  amountBelowReserveSen: number | null;
  contributions: Array<{ eventId: string; description: string; amountSen: number }>;
  suggestedAction: string;
  evidence: "confirmed" | "estimated" | "scenario_dependent" | "heuristic";
  scenarioDependent: boolean; resolved: boolean;
}
```

## Persistence

`localStorage["madani-twin-state-v1"]` stores the baseline definition + recorded custom ops + selection + supplier-agreement flag. On load the store **recomputes all scenarios from the baseline + ops** and validates structure; malformed or missing state falls back to the deterministic demo dataset. *Reset Demo* removes the key and rebuilds the initial state.
