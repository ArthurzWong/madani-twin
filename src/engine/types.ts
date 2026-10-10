/**
 * MADANI Twin — Core Types
 * ------------------------
 * All monetary values are stored as INTEGER SEN (1 RM = 100 sen).
 * Never use floating-point for financial equality checks.
 */

/** Event types supported by the ledger. */
export type LedgerEventType =
  | "receipt"          // money in (customer payment etc.)
  | "payroll"          // money out
  | "supplier_payment" // money out
  | "operating_expense"
  | "tax"
  | "loan_payment"
  | "other";

/** Provenance / source of a transaction or forecast. */
export type SourceLabel =
  | "user_entered"
  | "synthetic_demo"
  | "imported_history"
  | "rule_based_estimate"
  | "historical_median_forecast"
  | "scenario_assumption";

/** Data reliability class shown in UI and used by Payment Guardian. */
export type DataClass =
  | "known"          // confirmed / actual transaction
  | "user_assumption"// user-provided assumption
  | "heuristic"      // heuristic forecast
  | "scenario"       // scenario-generated value
  | "unknown";       // missing / unreliable information

export type LedgerEventStatus =
  | "confirmed"
  | "pending"
  | "forecasted"
  | "cancelled"
  | "corrected";

export type RecurrenceKind = "none" | "weekly" | "monthly" | "irregular";

export interface LedgerEvent {
  /** Unique id, stable across scenario copies. */
  id: string;
  /** Business or scenario id this event belongs to. */
  businessId: string;
  description: string;
  eventType: LedgerEventType;
  /** Signed amount in sen: positive = cash in, negative = cash out. */
  amountSen: number;
  /** ISO date string YYYY-MM-DD. */
  dueDate: string;
  /** ISO date string; for receipts this is the expected arrival date. */
  expectedDate: string;
  status: LedgerEventStatus;
  vendorOrCustomer: string;
  recurrence: RecurrenceKind;
  /** Where this event came from. */
  source: SourceLabel;
  /** UI data-classification badge. */
  dataClass: DataClass;
  /** 0..1 optional confidence; omitted when unknown. */
  confidence?: number;
  /** Invoice reference used by duplicate detection (may be empty). */
  invoiceRef?: string;
  /** Metadata that supports duplicate detection. */
  dupMeta?: {
    normalizedDescription: string;
    amountKey: string; // integer sen as string
    invoiceDate: string;
  };
  /** Optional note, e.g. "subject to supplier agreement". */
  note?: string;
  /** Day index relative to scenario Day 0 (for synthetic/scenario data). */
  dayIndex?: number;
}

/** Validation issue attached to an event (never silently dropped). */
export interface ValidationIssue {
  eventId: string;
  field: "amount" | "dueDate" | "expectedDate" | "id" | "description" | "other";
  severity: "error" | "warning";
  message: string;
}

/** Closing balance for a day. */
export interface DailyBalance {
  /** Day index from 0..horizon. */
  day: number;
  /** ISO date derived from anchorDate + day. */
  date: string;
  /** Closing-of-day cash in sen (after all events dated that day). */
  closingSen: number;
  /** Sum of signed events applied on this day (sen). */
  dayNetSen: number;
  /** Event ids applied on this day in deterministic order. */
  appliedEventIds: string[];
  /** True when closing cash < minimum reserve. */
  isBreach: boolean;
}

/** One contiguous run of breach days. */
export interface BreachEpisode {
  startDay: number;
  endDay: number;
  /** Minimum balance within the episode (sen). */
  minBalanceSen: number;
  /** Day the minimum occurred. */
  minDay: number;
  /** Worst shortfall vs reserve within the episode (sen, positive). */
  maxShortfallSen: number;
  /** Events the engine attributes to the minimum point. */
  responsibleEventIds: string[];
}

export interface EngineResult {
  openingCashSen: number;
  minimumReserveSen: number;
  horizonDays: number;
  daily: DailyBalance[];
  minBalanceSen: number;
  minDay: number;
  /** All breach episodes (may be several). */
  breachEpisodes: BreachEpisode[];
  /** First breach day or null. */
  firstBreachDay: number | null;
  /** Total shortfall = sum of daily (reserve - closing) over breach days (sen). */
  totalShortfallSen: number;
  validationIssues: ValidationIssue[];
}

/** Historical bill observation used by the forecasting engine. */
export interface BillObservation {
  id: string;
  vendor: string;
  category: string;
  amountSen: number;
  /** ISO date of the bill. */
  date: string;
}

export interface ForecastResult {
  vendor: string;
  category: string;
  /** Point estimate in sen, or null when no evidence at all. */
  pointEstimateSen: number | null;
  method:
    | "insufficient_history"
    | "robust_median"
    | "robust_median_trimmed"
    | "last_observed_fallback";
  evidence: "low" | "medium" | "high";
  sampleSize: number;
  /** Flagged outlier observations (kept, not deleted). */
  outlierIds: string[];
  /** Median absolute deviation in sen (when computable). */
  madSen?: number;
  /** Baseline comparison: last observed amount (sen) or null. */
  lastObservedSen: number | null;
  /** Held-out evaluation MAE in sen, when evaluable. */
  heldOutMaeSen?: number;
  /** Median-based forecast MAE on held-out, when evaluable. */
  baselineMaeSen?: number;
  /** Uncertainty interval in sen, or undefined when not justified. */
  intervalSen?: { lowSen: number; highSen: number };
  /** Human-readable uncertainty warning when no interval is shown. */
  uncertaintyWarning?: string;
}

export type AlertCategory =
  | "reserve_breach"
  | "delayed_receipt"
  | "unusual_invoice"
  | "duplicate_invoice"
  | "expense_shock"
  | "data_quality";

export type AlertSeverity = "critical" | "warning" | "info";

export type EvidenceClass = "confirmed" | "estimated" | "scenario_dependent" | "heuristic";

export interface RiskAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  explanation: string;
  /** Contributing transaction ids. */
  relatedEventIds: string[];
  /** Predicted breach / event day (day index) or null. */
  predictedDay: number | null;
  predictedDate: string | null;
  /** Predicted cash at the risk point (sen) or null. */
  predictedCashSen: number | null;
  minimumReserveSen: number;
  /** Amount below reserve at the risk point (sen, positive) or null. */
  amountBelowReserveSen: number | null;
  /** Contributing transactions with signed effect. */
  contributions: Array<{ eventId: string; description: string; amountSen: number }>;
  suggestedAction: string;
  evidence: EvidenceClass;
  /** true when the risk only exists under a scenario. */
  scenarioDependent: boolean;
  resolved: boolean;
}

export type Decision = "APPROVE" | "HOLD" | "REVIEW";

export interface Recommendation {
  eventId: string;
  description: string;
  decision: Decision;
  reasons: string[];
  /** Day at which the decision bites. */
  projectedDay: number | null;
  /** Testable action, e.g. "Postpone RM10,000 of this payment to Day 9". */
  suggestedAction: string | null;
  /** Pre-computed what-if: what happens if suggestedAction is applied. */
  actionPreview?: {
    description: string;
    newDay7CashSen?: number;
    newMinBalanceSen: number;
    breachesRemaining: number;
  };
}

/** A scenario modification applied on top of the baseline ledger. */
export type ScenarioOp =
  | { kind: "move_event"; eventId: string; newDay: number }
  | { kind: "change_amount"; eventId: string; newAmountSen: number }
  | { kind: "add_expense"; description: string; amountSen: number; day: number; vendor?: string }
  | { kind: "add_receipt"; description: string; amountSen: number; day: number; customer?: string }
  | { kind: "split_postpone"; eventId: string; deferSen: number; newDay: number }
  | { kind: "restore_event"; eventId: string }
  | { kind: "set_reserve"; newReserveSen: number };

export interface ScenarioState {
  id: string;
  name: string;
  description: string;
  ops: ScenarioOp[];
  /** Snapshot of the modified ledger after ops are applied. */
  ledger: LedgerEvent[];
  engine: EngineResult;
  /** Opening cash may be changed only via baseline definition. */
  openingCashSen: number;
  minimumReserveSen: number;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  expected: string;
  actual: string;
  pass: boolean;
  category: string;
}

export interface EvalCase {
  id: string;
  name: string;
  openingCashSen: number;
  minimumReserveSen: number;
  events: LedgerEvent[];
  /** Whether a breach is expected within the horizon. */
  expectBreach: boolean;
  /** Expected first breach day (null when none). */
  expectFirstBreachDay: number | null;
  expectedMinSen?: number;
  horizon: number;
}
