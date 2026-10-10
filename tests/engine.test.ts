import { describe, it, expect } from "vitest";
import { runEngine, calculateDailyBalances, findReserveBreaches, calculateMinimumBalance, calculateShortfall, calculateLeadTime } from "../src/engine/core";
import { validateLedger, sortEventsDeterministically, formatMYR, parseMYRToSen, isValidISODate } from "../src/engine/money";
import { buildDemoEvents, buildBaselineLedger, DEMO_CONSTANTS } from "../src/engine/demoScenario";
import { buildDemoBaseline, runScenario, applyOps } from "../src/engine/scenarios";
import { buildMandatoryScenarios, runFullSuite, generateForecastPairs } from "../src/engine/suite";
import { detectDuplicateInvoices, detectUnusualCharges } from "../src/engine/guardian";
import { forecastRecurringBill, median, mad, forecastMAE, forecastRMSE } from "../src/engine/forecast";
import { recall, falsePositiveRate, evaluateDetection, interventionEffectiveness } from "../src/engine/evaluation";
import { runSyntheticCases, buildSyntheticCases } from "../src/engine/syntheticCases";
import type { LedgerEvent } from "../src/engine/types";

const RM = (v: number) => Math.round(v * 100);

describe("Mandatory scenario arithmetic", () => {
  const { baseline, downside, intervention } = buildMandatoryScenarios();

  it("baseline day 0 = RM50,000", () => {
    expect(baseline.engine.daily[0].closingSen).toBe(5_000_000);
  });
  it("baseline day 5 = RM70,000 after receipt", () => {
    expect(baseline.engine.daily[5].closingSen).toBe(7_000_000);
  });
  it("baseline day 7 = RM25,000 after payroll + supplier", () => {
    expect(baseline.engine.daily[7].closingSen).toBe(2_500_000);
  });
  it("baseline has no reserve breach; min = RM25,000", () => {
    expect(baseline.engine.breachEpisodes).toHaveLength(0);
    expect(baseline.engine.minBalanceSen).toBe(2_500_000);
  });
  it("downside day 7 = RM5,000 (receipt moved, not duplicated)", () => {
    expect(downside.engine.daily[7].closingSen).toBe(500_000);
    const receipts = downside.ledger.filter((e) => e.eventType === "receipt" && e.status !== "cancelled");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].expectedDate).toBe("2026-11-10"); // Day 9
  });
  it("downside shortfall = RM5,000 below reserve", () => {
    expect(downside.engine.breachEpisodes[0].maxShortfallSen).toBe(500_000);
    expect(calculateShortfall(500_000, 1_000_000)).toBe(500_000);
  });
  it("downside first breach day = 7, lead time = 7 days", () => {
    expect(downside.engine.firstBreachDay).toBe(7);
    expect(calculateLeadTime(0, downside.engine.firstBreachDay!)).toBe(7);
  });
  it("intervention day 7 = RM15,000", () => {
    expect(intervention.engine.daily[7].closingSen).toBe(1_500_000);
  });
  it("intervention day 9 = RM25,000", () => {
    expect(intervention.engine.daily[9].closingSen).toBe(2_500_000);
  });
  it("intervention day 30 = RM25,000", () => {
    expect(intervention.engine.daily[30].closingSen).toBe(2_500_000);
  });
  it("intervention has no reserve breach and no double counting", () => {
    expect(intervention.engine.breachEpisodes).toHaveLength(0);
    const sup = intervention.ledger.filter((e) => e.id.startsWith("demo-supplier-001"));
    expect(sup).toHaveLength(2);
    expect(sup.reduce((s, e) => s + e.amountSen, 0)).toBe(-2_000_000);
    expect(sup.find((e) => e.id.endsWith("-defer"))!.note).toContain("supplier agreement");
  });
});

describe("Engine mechanics", () => {
  it("same-day events: receipts before payments, deterministic", () => {
    const base = buildDemoBaseline();
    const s = runScenario(base, "o", "o", "", [
      { kind: "add_receipt", description: "Same-day cash sale", amountSen: 300_000, day: 7 },
    ]);
    expect(s.engine.daily[7].closingSen).toBe(2_800_000); // 50,000 + 3,000 same-day receipt - 25,000 - 20,000
  });
  it("deterministic ordering is total (id tiebreak)", () => {
    const evs = buildBaselineLedger();
    const a = sortEventsDeterministically(evs);
    const b = sortEventsDeterministicsort_helper(evs);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });
  function sortEventsDeterministicsort_helper(e: LedgerEvent[]) {
    return sortEventsDeterministically([...e].reverse());
  }
  it("multiple breach episodes are reported (case-18)", () => {
    const results = runSyntheticCases();
    const c18 = results.find((r) => r.caseId === "case-18")!;
    expect(c18.pass).toBe(true);
  });
  it("scenario ops never mutate the baseline", () => {
    const fresh = buildDemoBaseline();
    runScenario(fresh, "x", "x", "", [
      { kind: "move_event", eventId: "demo-receipt-001", newDay: 20 },
      { kind: "change_amount", eventId: "demo-payroll-001", newAmountSen: -9_999_999 },
    ]);
    expect(fresh.ledger.find((e) => e.id === "demo-receipt-001")!.dayIndex).toBe(5);
    expect(fresh.ledger.find((e) => e.id === "demo-payroll-001")!.amountSen).toBe(-2_500_000);
  });
  it("reset scenario == pristine baseline", () => {
    const fresh = buildDemoBaseline();
    const reset = runScenario(fresh, "r", "r", "", []);
    expect(reset.ledger.length).toBe(3);
    expect(reset.engine.minBalanceSen).toBe(2_500_000);
    expect(reset.engine.breachEpisodes).toHaveLength(0);
  });
  it("breach strictly-less semantics: exactly-at-reserve is NOT a breach", () => {
    const base = buildDemoBaseline();
    const s = runScenario(base, "edge", "edge", "", [{ kind: "set_reserve", newReserveSen: 2_500_000 }]);
    expect(s.engine.breachEpisodes).toHaveLength(0);
  });
  it("closing cash formula matches spec", () => {
    const daily = calculateDailyBalances(1_000_000, buildBaselineLedger(), 30, "2026-11-01");
    expect(daily[0].closingSen).toBe(1_000_000);
    expect(daily[5].closingSen).toBe(3_000_000);
    expect(daily[7].closingSen).toBe(-1_500_000);
  });
});

describe("Validation", () => {
  it("invalid date reported and excluded from math", () => {
    const bad: LedgerEvent = { ...buildDemoEvents().payroll, id: "v1", expectedDate: "2026-02-30", dueDate: "2026-02-30" };
    const res = runEngine({ openingCashSen: 0, minimumReserveSen: 0, horizonDays: 30, events: [bad], anchorDate: "2026-11-01" });
    expect(res.validationIssues.some((i) => i.severity === "error" && i.eventId === "v1")).toBe(true);
    expect(res.daily.every((d) => !d.appliedEventIds.includes("v1"))).toBe(true);
  });
  it("non-integer amount reported", () => {
    const bad: LedgerEvent = { ...buildDemoEvents().payroll, id: "v2", amountSen: 1234.56 };
    const issues = validateLedger([bad]);
    expect(issues.some((i) => i.field === "amount" && i.severity === "error")).toBe(true);
  });
  it("zero amount warns but never crashes", () => {
    const z: LedgerEvent = { ...buildDemoEvents().payroll, id: "z", amountSen: 0 };
    const issues = validateLedger([z]);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });
  it("duplicate ids detected", () => {
    const e = buildDemoEvents().payroll;
    const issues = validateLedger([e, { ...e }]);
    expect(issues.some((i) => i.field === "id")).toBe(true);
  });
  it("ISO date validation catches impossible dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-11-01")).toBe(true);
    expect(isValidISODate("not-a-date")).toBe(false);
  });
  it("money parse/format round-trip", () => {
    expect(parseMYRToSen("RM1,234.50")).toBe(123450);
    expect(parseMYRToSen("-500.10")).toBe(-50010);
    expect(parseMYRToSen("abc")).toBeNull();
    expect(parseMYRToSen("1.234")).toBeNull();
    expect(formatMYR(123450)).toBe("RM1,234.50");
    expect(formatMYR(-500000, { compact: true })).toBe("-RM5,000");
  });
});

describe("Duplicate & anomaly detection", () => {
  it("exact duplicate detected by ref", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "d1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "X-1", vendorOrCustomer: "V" };
    const e2 = { ...e1, id: "d2" };
    const f = detectDuplicateInvoices([e1, e2]);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("exact");
  });
  it("legitimate repeats are NOT flagged", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "m1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "A-1", expectedDate: "2026-11-01" };
    const e2 = { ...e1, id: "m2", invoiceRef: "A-2", expectedDate: "2026-12-01" };
    expect(detectDuplicateInvoices([e1, e2])).toHaveLength(0);
  });
  it("near-duplicate (same vendor+amount, 3 days apart, different refs) flagged for review", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "n1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "R-1", expectedDate: "2026-11-06" };
    const e2 = { ...e1, id: "n2", invoiceRef: "R-2", expectedDate: "2026-11-09" };
    const f = detectDuplicateInvoices([e1, e2]);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("near");
  });
  it("cancelling one record clears the duplicate finding", () => {
    const e1 = { ...buildDemoEvents().payroll, id: "c1", eventType: "supplier_payment" as const, amountSen: -800_000, invoiceRef: "C-1" };
    const e2 = { ...e1, id: "c2", status: "cancelled" as const };
    expect(detectDuplicateInvoices([e1, e2])).toHaveLength(0);
  });
  it("robust unusual-charge detection with vendor history", () => {
    const history = [500000, 510000, 495000, 505000, 500000, 515000].map((s, i) => ({
      id: `h${i}`, vendor: "V", category: "g", amountSen: -s, date: `2026-0${i + 1}-01`,
    }));
    const candidate = { ...buildDemoEvents().payroll, id: "c", eventType: "supplier_payment" as const, amountSen: -5_000_000, vendorOrCustomer: "V" };
    const r = detectUnusualCharges(history, candidate);
    expect(r.unusual).toBe(true);
    expect(r.method).toBe("robust_statistical");
  });
  it("normal invoice not flagged", () => {
    const history = [500000, 510000, 495000, 505000].map((s, i) => ({
      id: `h${i}`, vendor: "V", category: "g", amountSen: -s, date: `2026-0${i + 1}-01`,
    }));
    const candidate = { ...buildDemoEvents().payroll, id: "c", eventType: "supplier_payment" as const, amountSen: -520_000, vendorOrCustomer: "V" };
    expect(detectUnusualCharges(history, candidate).unusual).toBe(false);
  });
});

describe("Bill forecasting", () => {
  it("median and MAD basics", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 9])).toBe(5);
    expect(mad([1, 1, 1, 1])).toBe(0);
  });
  it("low evidence: n=2 => insufficient_history + low", () => {
    const hist = [
      { id: "a", vendor: "V", category: "c", amountSen: 100000, date: "2026-01-01" },
      { id: "b", vendor: "V", category: "c", amountSen: 120000, date: "2026-02-01" },
    ];
    const f = forecastRecurringBill(hist, "V", "c");
    expect(f.method).toBe("insufficient_history");
    expect(f.evidence).toBe("low");
    expect(f.pointEstimateSen).toBe(110000);
  });
  it("no history => null estimate with warning", () => {
    const f = forecastRecurringBill([], "V", "c");
    expect(f.pointEstimateSen).toBeNull();
    expect(f.uncertaintyWarning).toBeTruthy();
  });
  it("outliers flagged and trimmed with n>=6", () => {
    const hist = [500000, 520000, 480000, 510000, 495000, 8_000_000].map((s, i) => ({
      id: `o${i}`, vendor: "V", category: "c", amountSen: s, date: `2026-0${i + 1}-01`,
    }));
    const f = forecastRecurringBill(hist, "V", "c");
    expect(f.outlierIds).toContain("o5");
    expect(f.method).toBe("robust_median_trimmed");
    expect(f.pointEstimateSen).toBe(500000);
  });

  it("MAE/RMSE metrics", () => {
    expect(forecastMAE([100], [90])).toBe(10);
    expect(forecastRMSE([100, 100], [90, 110])).toBe(10);
    expect(forecastMAE([], [])).toBeNull();
  });
  it("forecast pair series is deterministic", () => {
    const a = generateForecastPairs();
    const b = generateForecastPairs();
    expect(a).toEqual(b);
    expect(a.predictions.length).toBe(9);
  });
});

describe("Evaluation metrics", () => {
  it("zero denominators return null (honest)", () => {
    expect(recall({ tp: 0, fp: 0, fn: 0, tn: 5 })).toBeNull();
    expect(falsePositiveRate({ tp: 3, fp: 0, fn: 0, tn: 0 })).toBeNull();
  });
  it("recall & FPR compute correctly", () => {
    expect(recall({ tp: 8, fp: 1, fn: 2, tn: 9 })).toBeCloseTo(8 / 10);
    expect(falsePositiveRate({ tp: 8, fp: 1, fn: 2, tn: 9 })).toBeCloseTo(1 / 10);
  });
  it("detection counts over synthetic cases", () => {
    const cases = buildSyntheticCases();
    const counts = evaluateDetection(cases, (engine) => engine.breachEpisodes.length > 0);
    expect(counts.tp + counts.fn).toBe(cases.filter((c) => c.expectBreach).length);
    expect(counts.tp + counts.fp + counts.fn + counts.tn).toBe(cases.length);
  });
  it("intervention effectiveness on mandatory scenarios", () => {
    const { downside, intervention } = buildMandatoryScenarios();
    const eff = interventionEffectiveness(downside.engine, intervention.engine);
    expect(eff.breachEliminated).toBe(true);
    expect(eff.minBalanceAfterSen - eff.minBalanceBeforeSen).toBe(1_000_000); // RM5,000 -> RM15,000
    expect(eff.breachDaysBefore).toBeGreaterThan(0);
    expect(eff.breachDaysAfter).toBe(0);
  });
});

describe("Synthetic battery", () => {
  it("has at least 20 cases", () => {
    expect(buildSyntheticCases().length).toBeGreaterThanOrEqual(20);
  });
  it("all cases pass against the real engine", () => {
    const results = runSyntheticCases();
    const failed = results.filter((r) => !r.pass);
    expect(failed).toEqual([]);
  });
  it("results are deterministic across runs", () => {
    const a = runSyntheticCases().map((r) => r.pass);
    const b = runSyntheticCases().map((r) => r.pass);
    expect(a).toEqual(b);
  });
});

describe("Full acceptance suite", () => {
  const suite = runFullSuite();
  it("every acceptance check passes", () => {
    const failed = suite.cases.filter((c) => !c.pass);
    if (failed.length > 0) {
      console.error("FAILED:", failed.map((f) => `${f.id} ${f.name}: ${f.actual}`));
    }
    expect(failed).toEqual([]);
  });
  it("suite covers all mandatory areas", () => {
    const cats = new Set(suite.cases.map((c) => c.category));
    expect(cats.has("mandatory")).toBe(true);
    expect(cats.has("engine")).toBe(true);
    expect(cats.has("guardian")).toBe(true);
    expect(cats.has("forecast")).toBe(true);
    expect(cats.has("validation")).toBe(true);
    expect(cats.has("synthetic")).toBe(true);
  });
});
