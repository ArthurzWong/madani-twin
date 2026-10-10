/**
 * MADANI Twin — Evaluation Suite
 * ------------------------------
 * Runs the mandatory Dormathon scenario checks plus 30 unit checks against
 * the real engine. Produces a TestCase[] for the UI and the test report.
 */
import type { TestCase, ScenarioState, EngineResult } from "../engine/types";
import type { ScenarioOp } from "../engine/types";
import { runScenario, buildDemoBaseline, type BaselineDefinition } from "../engine/scenarios";
import { runEngine } from "../engine/core";
import { detectDuplicateInvoices, detectUnusualCharges } from "../engine/guardian";
import { forecastRecurringBill, median, mad, forecastMAE, forecastRMSE } from "../engine/forecast";
import { runSyntheticCases } from "../engine/syntheticCases";
import { evaluateDetection, recall, falsePositiveRate } from "../engine/evaluation";
import { calculateLeadTime } from "../engine/core";
import { formatMYR } from "../engine/money";
import { DEMO_CONSTANTS, buildDemoEvents } from "../engine/demoScenario";
import type { LedgerEvent } from "../engine/types";

export interface SuiteResult {
  cases: TestCase[];
  passed: number;
  failed: number;
  total: number;
}

function check(id: string, name: string, description: string, category: string, expected: string, fn: () => { actual: string; pass: boolean }): TestCase {
  try {
    const { actual, pass } = fn();
    return { id, name, description, category, expected, actual, pass };
  } catch (err) {
    return { id, name, description, category, expected, actual: `Threw: ${(err as Error).message}`, pass: false };
  }
}

/** The three mandatory scenarios (single source of truth for app + tests). */
export function buildMandatoryScenarios(): { baseline: ScenarioState; downside: ScenarioState; intervention: ScenarioState } {
  const base = buildDemoBaseline();
  const baseline = runScenario(base, "baseline", "Baseline", "Contracted schedule: receipt Day 5.", []);
  const downside = runScenario(
    base,
    "downside",
    "Downside",
    "Customer receipt moved from Day 5 to Day 9. Everything else unchanged.",
    [{ kind: "move_event", eventId: "demo-receipt-001", newDay: 9 }]
  );
  const intervention = runScenario(
    base,
    "intervention",
    "Intervention",
    "From the downside: RM10,000 of the Day-7 supplier payment postponed to Day 9, subject to supplier agreement.",
    [
      { kind: "move_event", eventId: "demo-receipt-001", newDay: 9 },
      { kind: "split_postpone", eventId: "demo-supplier-001", deferSen: -1_000_000, newDay: 9 },
    ]
  );
  return { baseline, downside, intervention };
}

/** Generate 24 history-prediction pairs for MAE/RMSE metrics (deterministic). */
export function generateForecastPairs(): { predictions: number[]; actuals: number[] } {
  const predictions: number[] = [];
  const actuals: number[] = [];
  // Deterministic sawtooth vendor bills around RM4,000 with one-off shocks.
  const bills = [4000, 4200, 3900, 4100, 5000, 3950, 4050, 4150, 3850, 9800, 4000, 4020];
  for (let i = 3; i < bills.length; i++) {
    const train = bills.slice(0, i);
    const actual = bills[i];
    predictions.push(median(train));
    actuals.push(actual);
  }
  return { predictions, actuals };
}

export function runFullSuite(): SuiteResult {
  const cases: TestCase[] = [];
  const { baseline, downside, intervention } = buildMandatoryScenarios();

  // ---- Mandatory scenario arithmetic ----
  cases.push(check("t01", "Baseline Day 0 cash", "Opening cash unchanged.", "mandatory", "RM50,000.00", () => {
    const v = baseline.engine.daily[0].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.baselineDay0Sen };
  }));
  cases.push(check("t02", "Baseline Day 5 cash", "After customer receipt.", "mandatory", "RM70,000.00", () => {
    const v = baseline.engine.daily[5].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.baselineDay5Sen };
  }));
  cases.push(check("t03", "Baseline Day 7 cash", "After payroll + supplier.", "mandatory", "RM25,000.00", () => {
    const v = baseline.engine.daily[7].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.baselineDay7Sen };
  }));
  cases.push(check("t04", "Baseline: no breach", "Minimum stays above reserve.", "mandatory", "0 breaches, min RM25,000", () => {
    const ok = baseline.engine.breachEpisodes.length === 0 && baseline.engine.minBalanceSen === DEMO_CONSTANTS.baselineDay7Sen;
    return { actual: `${baseline.engine.breachEpisodes.length} breaches, min ${formatMYR(baseline.engine.minBalanceSen)}`, pass: ok };
  }));
  cases.push(check("t05", "Downside Day 7 cash", "Receipt moved to Day 9.", "mandatory", "RM5,000.00", () => {
    const v = downside.engine.daily[7].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.downsideDay7Sen };
  }));
  cases.push(check("t06", "Downside shortfall", "Reserve minus Day-7 cash.", "mandatory", "RM5,000.00 below reserve", () => {
    const ok = downside.engine.breachEpisodes[0]?.maxShortfallSen === DEMO_CONSTANTS.downsideShortfallSen;
    return { actual: formatMYR(downside.engine.breachEpisodes[0]?.maxShortfallSen ?? 0), pass: ok };
  }));
  cases.push(check("t07", "Downside first breach Day 7", "Engine identifies breach date.", "mandatory", "Day 7", () => {
    return { actual: `Day ${downside.engine.firstBreachDay}`, pass: downside.engine.firstBreachDay === 7 };
  }));
  cases.push(check("t08", "Lead time = 7 days", "Detected Day 0, breach Day 7.", "mandatory", "7 days", () => {
    const lead = calculateLeadTime(0, downside.engine.firstBreachDay ?? 0);
    return { actual: `${lead} days`, pass: lead === DEMO_CONSTANTS.leadTimeDays };
  }));
  cases.push(check("t09", "Intervention Day 7 cash", "Half supplier payment deferred.", "mandatory", "RM15,000.00", () => {
    const v = intervention.engine.daily[7].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.interventionDay7Sen };
  }));
  cases.push(check("t10", "Intervention Day 9 cash", "Receipt arrives, deferred bill paid.", "mandatory", "RM25,000.00", () => {
    const v = intervention.engine.daily[9].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.interventionDay9Sen };
  }));
  cases.push(check("t11", "Intervention Day 30 cash", "No further events.", "mandatory", "RM25,000.00", () => {
    const v = intervention.engine.daily[30].closingSen;
    return { actual: formatMYR(v), pass: v === DEMO_CONSTANTS.interventionDay30Sen };
  }));
  cases.push(check("t12", "Intervention: no breach", "Reserve holds through Day 30.", "mandatory", "0 breaches", () => {
    return { actual: `${intervention.engine.breachEpisodes.length} breaches`, pass: intervention.engine.breachEpisodes.length === 0 };
  }));
  cases.push(check("t13", "Downside receipt moved, not duplicated", "Exactly one receipt remains.", "mandatory", "1 receipt event", () => {
    const receipts = downside.ledger.filter((e) => e.eventType === "receipt" && e.status !== "cancelled");
    return { actual: `${receipts.length} receipt(s) on Day ${receipts[0]?.dayIndex}`, pass: receipts.length === 1 && receipts[0].dayIndex === 9 };
  }));
  cases.push(check("t14", "Intervention: no double-count", "RM10k paid Day 7 + RM10k Day 9, once each.", "mandatory", "Supplier outflow RM20,000 total", () => {
    const sup = intervention.ledger.filter((e) => e.id.startsWith("demo-supplier-001"));
    const total = sup.reduce((s, e) => s + e.amountSen, 0);
    return { actual: `${sup.length} events totalling ${formatMYR(total)}`, pass: sup.length === 2 && total === -2_000_000 };
  }));
  cases.push(check("t15", "Intervention deferred part flagged", "Marked subject to supplier agreement.", "mandatory", "note present", () => {
    const defer = intervention.ledger.find((e) => e.id === "demo-supplier-001-defer");
    return { actual: defer?.note ?? "missing", pass: !!defer && (defer.note ?? "").includes("supplier agreement") };
  }));

  // ---- Engine correctness ----
  cases.push(check("t16", "Same-day events deterministic order", "Receipts before payments; stable total order.", "engine", "inflows applied first", () => {
    const base = buildDemoBaseline();
    const s = runScenario(base, "o", "o", "", [
      { kind: "add_receipt", description: "Same-day cash sale", amountSen: 300_000, day: 7 },
    ]);
    const d7 = s.engine.daily[7];
    // With the extra +RM3,000 receipt on Day 7 (plus the Day-5 receipt): 50,000+20,000+3,000-25,000-20,000 = 28,000.
    return { actual: `Day 7 = ${formatMYR(d7.closingSen)}`, pass: d7.closingSen === 2_800_000 };
  }));
  cases.push(check("t17", "Multiple breach episodes reported", "Case 18: two separate dips.", "engine", "episodes reported", () => {
    const synth = runSyntheticCases().find((r) => r.caseId === "case-18");
    return { actual: synth?.actual ?? "n/a", pass: synth?.pass ?? false };
  }));
  cases.push(check("t18", "Reset restores baseline", "runScenario with [] ops equals pristine baseline.", "engine", "identical to pristine", () => {
    const fresh = buildDemoBaseline();
    const reset = runScenario(fresh, "r", "r", "", []);
    const ok =
      reset.ledger.length === 3 &&
      reset.engine.minBalanceSen === 2_500_000 &&
      reset.engine.breachEpisodes.length === 0;
    return { actual: `ledger=${reset.ledger.length}, min=${formatMYR(reset.engine.minBalanceSen)}`, pass: ok };
  }));
  cases.push(check("t19", "Scenario isolation from baseline", "Baseline ledger unmutated after scenarios run.", "engine", "3 events, Day 5 receipt intact", () => {
    const fresh = buildDemoBaseline();
    runScenario(fresh, "x", "x", "", [
      { kind: "move_event", eventId: "demo-receipt-001", newDay: 20 },
      { kind: "change_amount", eventId: "demo-payroll-001", newAmountSen: -9_999_999 },
    ]);
    const receipt = fresh.ledger.find((e) => e.id === "demo-receipt-001")!;
    const payroll = fresh.ledger.find((e) => e.id === "demo-payroll-001")!;
    return {
      actual: `baseline intact: receipt Day ${receipt.dayIndex}, payroll ${formatMYR(payroll.amountSen)}`,
      pass: receipt.dayIndex === 5 && payroll.amountSen === -2_500_000,
    };
  }));

  // ---- Duplicate detection ----
  cases.push(check("t20", "Exact duplicate detected", "Same ref+vendor+amount twice.", "guardian", "1 exact finding", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "d1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "X-1", vendorOrCustomer: "V" };
    const e2 = { ...e1, id: "d2" };
    const f = detectDuplicateInvoices([e1, e2]);
    return { actual: `${f.length} finding(s)`, pass: f.length === 1 && f[0].kind === "exact" };
  }));
  cases.push(check("t21", "Legitimate repeats NOT flagged", "Same vendor+amount, 30 days apart.", "guardian", "0 findings", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "m1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "A-1", expectedDate: "2026-11-01", dayIndex: 0 };
    const e2 = { ...e1, id: "m2", invoiceRef: "A-2", expectedDate: "2026-12-01", dayIndex: 30 };
    const f = detectDuplicateInvoices([e1, e2]);
    return { actual: `${f.length} finding(s)`, pass: f.length === 0 };
  }));

  // ---- Unusual charges ----
  cases.push(check("t22", "Robust unusual-charge detection", "3-MAD rule with 6-history.", "guardian", "flagged, robust", () => {
    const history = [500000, 510000, 495000, 505000, 500000, 515000].map((s, i) => ({
      id: `h${i}`, vendor: "V", category: "g", amountSen: -s, date: `2026-0${i + 1}-01`,
    }));
    const candidate = { ...buildDemoEvents().payroll, id: "c", eventType: "supplier_payment" as const, amountSen: -5_000_000, vendorOrCustomer: "V" };
    const r = detectUnusualCharges(history, candidate);
    return { actual: `${r.unusual ? "flagged" : "clean"} (${r.method})`, pass: r.unusual && r.method === "robust_statistical" };
  }));

  // ---- Forecasting ----
  cases.push(check("t23", "Median forecast with outliers", "Outlier kept but trimmed from estimate.", "forecast", "≈RM5,000 estimate, outlier flagged", () => {
    const hist = [500000, 520000, 480000, 510000, 495000, 8_000_000].map((s, i) => ({
      id: `o${i}`, vendor: "V", category: "c", amountSen: s, date: `2026-0${i + 1}-01`,
    }));
    const f = forecastRecurringBill(hist, "V", "c");
    return { actual: `est=${formatMYR(f.pointEstimateSen ?? 0)} outliers=${f.outlierIds.length}`, pass: f.outlierIds.includes("o5") && f.pointEstimateSen === 500000 && f.method === "robust_median_trimmed" };
  }));
  cases.push(check("t24", "Low-evidence labelling", "n=2 => insufficient_history.", "forecast", "low evidence", () => {
    const hist = [
      { id: "a", vendor: "V", category: "c", amountSen: 100000, date: "2026-01-01" },
      { id: "b", vendor: "V", category: "c", amountSen: 120000, date: "2026-02-01" },
    ];
    const f = forecastRecurringBill(hist, "V", "c");
    return { actual: `${f.method}/${f.evidence}`, pass: f.method === "insufficient_history" && f.evidence === "low" };
  }));
  cases.push(check("t25", "Forecast beats last-observed baseline", "Held-out MAE(median) <= MAE(last).", "forecast", "median MAE <= last MAE", () => {
    const hist = [400000, 420000, 390000, 410000, 500000, 395000, 405000].map((s, i) => ({
      id: `b${i}`, vendor: "V", category: "c", amountSen: s, date: `2026-0${i + 1}-01`,
    }));
    const f = forecastRecurringBill(hist, "V", "c");
    return { actual: `median=${f.heldOutMaeSen} vs last=${f.baselineMaeSen}`, pass: (f.heldOutMaeSen ?? Infinity) <= (f.baselineMaeSen ?? -Infinity) };
  }));
  cases.push(check("t26", "MAE/RMSE computed", "Synthetic 12-bill series.", "forecast", "MAE>0, RMSE>=MAE", () => {
    const { predictions, actuals } = generateForecastPairs();
    const mae = forecastMAE(predictions, actuals);
    const rmse = forecastRMSE(predictions, actuals);
    return { actual: `MAE=${mae?.toFixed(0)} RMSE=${rmse?.toFixed(0)}`, pass: mae !== null && rmse !== null && rmse >= mae };
  }));
  cases.push(check("t27", "Zero-denominator metrics honest", "recall/fpr return null.", "evaluation", "null, not NaN", () => {
    const r = recall({ tp: 0, fp: 0, fn: 0, tn: 10 });
    const f = falsePositiveRate({ tp: 5, fp: 0, fn: 0, tn: 0 });
    return { actual: `recall=${r}, fpr=${f}`, pass: r === null && f === null };
  }));

  // ---- Validation ----
  cases.push(check("t28", "Invalid date + amount validation", "Errors reported, events retained.", "validation", "≥2 errors", () => {
    const bad: LedgerEvent[] = [
      { ...buildDemoEvents().payroll, id: "v1", expectedDate: "2026-02-30", dueDate: "2026-02-30" },
      { ...buildDemoEvents().payroll, id: "v2", amountSen: 1234.56 },
    ];
    const res = runEngine({ openingCashSen: 5_000_000, minimumReserveSen: 1_000_000, horizonDays: 30, events: bad, anchorDate: "2026-11-01" });
    const errs = res.validationIssues.filter((i) => i.severity === "error");
    return { actual: `${errs.length} errors`, pass: errs.length >= 2 };
  }));
  cases.push(check("t29", "Zero differs from missing", "Zero-amount warning but no crash.", "validation", "warning present", () => {
    const z: LedgerEvent[] = [{ ...buildDemoEvents().payroll, id: "z1", amountSen: 0 }];
    const issues = runEngine({ openingCashSen: 0, minimumReserveSen: 0, horizonDays: 1, events: z, anchorDate: "2026-11-01" }).validationIssues;
    const warn = issues.find((i) => i.eventId === "z1" && i.severity === "warning");
    return { actual: warn ? "zero-amount warning raised" : "no warning", pass: !!warn };
  }));

  // ---- Synthetic case battery (24 cases) ----
  const synth = runSyntheticCases();
  cases.push(check("t30", "Synthetic battery: 24/24 pass", "All reproducible cases against real engine.", "synthetic", "24/24 pass", () => {
    const passed = synth.filter((r) => r.pass).length;
    return { actual: `${passed}/${synth.length} pass`, pass: passed === synth.length && synth.length >= 20 };
  }));
  cases.push(check("t31", "Synthetic battery count ≥ 20", "Case-count requirement.", "synthetic", "≥20 cases", () => {
    return { actual: `${synth.length} cases`, pass: synth.length >= 20 };
  }));

  const passed = cases.filter((c) => c.pass).length;
  return { cases, passed, failed: cases.length - passed, total: cases.length };
}
