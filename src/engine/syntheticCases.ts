/**
 * MADANI Twin — Synthetic Test Cases
 * ----------------------------------
 * 24 reproducible cases (deterministic — fixed seeds / explicit events, no Math.random).
 * Each case: named scenario, expected result, and a checker that runs the real engine.
 */
import type { LedgerEvent, EvalCase, TestCase } from "./types";
import { makeEvent, resetIdCounter, isoForDayPublic, DEMO_ANCHOR_DATE, DEMO_OPENING_SEN, DEMO_RESERVE_SEN } from "./demoScenario";
import { runEngine } from "./core";
import { detectDuplicateInvoices, detectUnusualCharges } from "./guardian";
import { forecastRecurringBill, forecastMAE } from "./forecast";
import { formatMYR } from "./money";

const RM = (v: number) => Math.round(v * 100); // RM to sen
const H = 30;

/** Helper to build a case ledger from compact tuples. */
function ev(
  id: string,
  description: string,
  type: LedgerEvent["eventType"],
  amountSen: number,
  day: number,
  vendor = "Generic",
  extra?: Partial<LedgerEvent>
): LedgerEvent {
  const base = makeEvent({
    id,
    description,
    eventType: type,
    amountSen,
    day,
    vendorOrCustomer: vendor,
    anchor: DEMO_ANCHOR_DATE,
  });
  return { ...base, ...extra };
}

/** Standard opening events for generated cases: opening cash via engine input. */
function caseEvents(list: LedgerEvent[]): LedgerEvent[] {
  return list;
}

export interface SyntheticCase extends EvalCase {
  /** Human description of expected outcome. */
  expectNote: string;
  category: string;
  [key: string]: unknown;
}

export function buildSyntheticCases(): SyntheticCase[] {
  resetIdCounter();
  const cases: SyntheticCase[] = [];

  // 1. Normal cash flow — no breach.
  cases.push({
    id: "case-01",
    name: "Normal cash flow",
    description: "Receipt arrives before obligations; ample buffer.",
    category: "normal",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c1-rcp", "Customer receipt", "receipt", RM(20000), 3, "Customer A"),
      ev("c1-pay", "Payroll", "payroll", -RM(15000), 8, "Payroll"),
      ev("c1-sup", "Supplier payment", "supplier_payment", -RM(10000), 10, "Supplier B"),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "No reserve breach; minimum stays above RM10,000.",
  });

  // 2. Receipt delayed by one day — payroll moves before the receipt.
  cases.push({
    id: "case-02",
    name: "Receipt delayed by 1 day",
    description: "Payroll Day 6 lands before the receipt now arriving Day 6... order matters: cash dips below reserve on Day 6, recovered Day 7.",
    category: "delay",
    openingCashSen: RM(38000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c2-rcp", "Customer receipt", "receipt", RM(20000), 6, "Customer A"),
      ev("c2-pay", "Payroll", "payroll", -RM(25000), 6, "Payroll"),
      ev("c2-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 6, expectedMinSen: RM(13000),
    expectNote: "Without the delay (receipt Day 5) there is no breach; with the 1-day delay Day 6 closes at RM13,000 — RM1 below the RM10,000 reserve? No: RM3,000 below.",
  });
  // Arithmetic: opening 38,000; Day 6: +20,000 -25,000 = 33,000 (no breach); Day 7: -20,000 → 13,000 (no breach).
  // That gives NO breach. To genuinely model a 1-day delay mattering: original receipt Day 5, delayed to Day 6,
  // payroll Day 5 (was covered by the receipt), supplier Day 6. Opening 38,000:
  // baseline: D5 +20,000-25,000 → 33,000; D6 -20,000 → 13,000 → no breach.
  // delayed:  D5 -25,000 → 13,000 (no breach, above 10,000); D6 +20,000-20,000 → 13,000 → no breach. Still none!
  // Use opening 33,000 with payroll 25,000 on D5, receipt 20,000 delayed D5→D6, supplier 20,000 on D6:
  // delayed: D5: 33,000-25,000=8,000 → BREACH (RM2,000 below), D6: 8,000+20,000-20,000=8,000 → still breach; D7+ stays 8,000 → episode continues.
  cases.pop(); // replace the version above
  cases.push({
    id: "case-02",
    name: "Receipt delayed by 1 day",
    description: "Opening RM33,000. Payroll RM25,000 on Day 5 was coverable when the receipt arrived Day 5; with the receipt delayed to Day 6, Day 5 closes at RM8,000 — a breach that a 1-day slip creates.",
    category: "delay",
    openingCashSen: RM(33000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c2-pay", "Payroll", "payroll", -RM(25000), 5, "Payroll"),
      ev("c2-rcp", "Customer receipt (delayed)", "receipt", RM(20000), 6, "Customer A"),
      ev("c2-sup", "Supplier payment", "supplier_payment", -RM(20000), 6, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 5, expectedMinSen: RM(8000),
    expectNote: "Day 5 closing RM8,000 (RM2,000 below reserve) purely due to the 1-day receipt delay; recovered Day 6.",
  });

  // 3. Receipt delayed by four days (arrives Day 9 like the mandatory downside).
  cases.push({
    id: "case-03",
    name: "Receipt delayed by 4 days (mandatory downside)",
    description: "Receipt Day 9; payroll + supplier Day 7.",
    category: "delay",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c3-rcp", "Customer receipt", "receipt", RM(20000), 9, "Customer A"),
      ev("c3-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c3-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(5000),
    expectNote: "Day 7 closing cash RM5,000; breach RM5,000 below reserve; recovers Day 9.",
  });

  // 4. Receipt delayed beyond payroll entirely (arrives Day 12).
  cases.push({
    id: "case-04",
    name: "Receipt delayed beyond payroll",
    description: "Receipt Day 12; obligations Day 7.",
    category: "delay",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c4-rcp", "Customer receipt", "receipt", RM(20000), 12, "Customer A"),
      ev("c4-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c4-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(5000),
    expectNote: "Deeper/longer breach episode from Day 7 to Day 11.",
  });

  // 5. Receipt reduced by 25%.
  cases.push({
    id: "case-05",
    name: "Receipt reduced by 25%",
    description: "RM15,000 instead of RM20,000.",
    category: "shortfall",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c5-rcp", "Customer receipt", "receipt", RM(15000), 5, "Customer A"),
      ev("c5-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c5-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(10000),
    expectNote: "Day 7 cash exactly RM10,000 — strictly below? No: 10000 < 10000 is false; borderline pass.",
  });

  // Fix case 5 expectation: RM50,000 + 15,000 - 25,000 - 20,000 = 20,000? No:
  // 50000+15000=65000; 65000-25000-20000=20000 → no breach. Keep as no-breach.
  cases[4].expectBreach = false;
  cases[4].expectFirstBreachDay = null;
  cases[4].expectedMinSen = RM(20000);
  cases[4].expectNote = "Day 7 cash RM20,000 — no breach (reduced receipt still covers obligations).";

  // 6. Receipt reduced by 50%.
  cases.push({
    id: "case-06",
    name: "Receipt reduced by 50%",
    description: "RM10,000 instead of RM20,000.",
    category: "shortfall",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c6-rcp", "Customer receipt", "receipt", RM(10000), 5, "Customer A"),
      ev("c6-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c6-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(15000),
    expectNote: "Day 7 cash RM15,000 — above reserve. Adjusted: no breach.",
  });
  // 50000+10000-25000-20000 = 15000 → above reserve → no breach.
  cases[5].expectBreach = false;
  cases[5].expectFirstBreachDay = null;
  cases[5].expectNote = "Day 7 cash RM15,000 — no breach.";

  // 7. Unexpected small expense (RM2,000 on Day 6).
  cases.push({
    id: "case-07",
    name: "Unexpected small expense",
    description: "RM2,000 repair on Day 6.",
    category: "shock",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c7-rcp", "Customer receipt", "receipt", RM(20000), 5, "Customer A"),
      ev("c7-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c7-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
      ev("c7-fix", "Emergency equipment repair", "operating_expense", -RM(2000), 6, "Repair Co"),
    ]),
    expectBreach: false, expectFirstBreachDay: null, expectedMinSen: RM(23000),
    expectNote: "Day 7 cash RM23,000 — no breach.",
  });

  // 8. Unexpected large expense (RM18,000 on Day 6) — pushes below reserve.
  cases.push({
    id: "case-08",
    name: "Unexpected large expense",
    description: "RM18,000 equipment failure on Day 6.",
    category: "shock",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c8-rcp", "Customer receipt", "receipt", RM(20000), 5, "Customer A"),
      ev("c8-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c8-sup", "Supplier payment", "supplier_payment", -RM(20000), 7, "Supplier B"),
      ev("c8-fix", "Emergency compressor replacement", "operating_expense", -RM(18000), 6, "Repair Co"),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(7000),
    expectNote: "Day 7 cash RM7,000 — RM3,000 below reserve.",
  });

  // 9. Multiple expenses on the same date (deterministic ordering).
  cases.push({
    id: "case-09",
    name: "Multiple same-day expenses",
    description: "Two bills and payroll all on Day 7.",
    category: "ordering",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c9-rcp", "Customer receipt", "receipt", RM(20000), 5, "Customer A"),
      ev("c9-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c9-sup1", "Supplier payment A", "supplier_payment", -RM(10000), 7, "Supplier B"),
      ev("c9-sup2", "Supplier payment B", "supplier_payment", -RM(10000), 7, "Supplier C"),
    ]),
    expectBreach: false, expectFirstBreachDay: null, expectedMinSen: RM(25000),
    expectNote: "Same-day events net correctly: Day 7 cash RM25,000.",
  });

  // 10. Exact duplicate invoice (same ref/vendor/amount twice).
  cases.push({
    id: "case-10",
    name: "Exact duplicate invoice",
    description: "SBU-8817 recorded twice.",
    category: "duplicate",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c10-sup1", "Supplier payment — Syarikat Bekalan Utama", "supplier_payment", -RM(8000), 6, "Syarikat Bekalan Utama", { invoiceRef: "SBU-8817" }),
      ev("c10-sup2", "Supplier payment — Syarikat Bekalan Utama", "supplier_payment", -RM(8000), 6, "Syarikat Bekalan Utama", { invoiceRef: "SBU-8817" }),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "Duplicate detector reports 1 exact finding for the two records.",
  });

  // 11. Possible near-duplicate (same vendor+amount, 3 days apart, different refs).
  cases.push({
    id: "case-11",
    name: "Possible near-duplicate invoice",
    description: "Same vendor+amount 3 days apart, different refs.",
    category: "duplicate",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c11-sup1", "Supplier payment", "supplier_payment", -RM(8000), 6, "Vendor D", { invoiceRef: "VD-1001" }),
      ev("c11-sup2", "Supplier payment", "supplier_payment", -RM(8000), 9, "Vendor D", { invoiceRef: "VD-1042" }),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "Duplicate detector reports 1 near-duplicate finding (not exact).",
  });

  // 12. Same vendor and amount, distinct legitimate invoices (a month apart).
  cases.push({
    id: "case-12",
    name: "Legitimate repeated invoices",
    description: "Monthly rent-like billing, >14 days apart.",
    category: "duplicate",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c12-sup1", "Supplier payment October", "supplier_payment", -RM(8000), 2, "Vendor E", { invoiceRef: "VE-OCT" }),
      ev("c12-sup2", "Supplier payment November", "supplier_payment", -RM(8000), 26, "Vendor E", { invoiceRef: "VE-NOV" }),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "No duplicate finding — 24 days apart, distinct refs.",
  });

  // 13. Unusual vendor charge (robust statistical rule).
  cases.push({
    id: "case-13",
    name: "Unusual vendor charge",
    description: "Vendor normally bills ~RM5,000; suddenly RM45,000.",
    category: "anomaly",
    openingCashSen: RM(60000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      // history is passed separately to detectUnusualCharges in the checker
      ev("c13-sup", "Supplier payment — huge", "supplier_payment", -RM(45000), 6, "Steady Vendor"),
    ]),
    expectBreach: false, expectFirstBreachDay: null, expectedMinSen: RM(15000),
    expectNote: "Unusual-charge detector (robust, using vendor history) flags the RM45,000 invoice; cash stays at RM15,000 — no breach.",
  });

  // 14. Missing historical bill observations.
  cases.push({
    id: "case-14",
    name: "Missing historical observations",
    description: "Vendor history with a gap; forecast still produced.",
    category: "forecast",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: [],
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "Forecast on gappy history returns a median estimate with low/medium evidence.",
  });

  // 15. Insufficient bill history (n=2).
  cases.push({
    id: "case-15",
    name: "Insufficient bill history",
    description: "Only 2 observations — low-evidence label.",
    category: "forecast",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: [],
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "forecastRecurringBill returns method=insufficient_history, evidence=low.",
  });

  // 16. Extreme historical outlier.
  cases.push({
    id: "case-16",
    name: "Extreme historical outlier",
    description: "One RM80,000 anomaly among RM5,000 bills.",
    category: "forecast",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: [],
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "Outlier flagged, not deleted; trimmed median stays near RM5,000.",
  });

  // 17. Supplier payment partly deferred (intervention mechanics).
  cases.push({
    id: "case-17",
    name: "Supplier payment partly deferred",
    description: "RM10,000 of RM20,000 moved from Day 7 to Day 9 with receipt on Day 9.",
    category: "intervention",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c17-rcp", "Customer receipt", "receipt", RM(20000), 9, "Customer A"),
      ev("c17-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c17-sup-a", "Supplier payment (part)", "supplier_payment", -RM(10000), 7, "Supplier B"),
      ev("c17-sup-b", "Supplier payment (deferred part)", "supplier_payment", -RM(10000), 9, "Supplier B", { note: "Subject to supplier agreement" }),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectedMinSen: RM(15000),
    expectNote: "Day 7 cash RM15,000; Day 9 RM25,000; no breach.",
  });

  // 18. Supplier payment deferred but creates a LATER breach.
  cases.push({
    id: "case-18",
    name: "Deferred payment creates later breach",
    description: "Deferral moves the problem to Day 9 where cash is tight.",
    category: "intervention",
    openingCashSen: RM(40000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c18-rcp", "Customer receipt", "receipt", RM(20000), 9, "Customer A"),
      ev("c18-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c18-sup-a", "Supplier payment (part)", "supplier_payment", -RM(5000), 7, "Supplier B"),
      ev("c18-sup-b", "Supplier payment (deferred part)", "supplier_payment", -RM(15000), 9, "Supplier B", { note: "Subject to supplier agreement" }),
    ]),
    expectBreach: true, expectFirstBreachDay: 7, expectedMinSen: RM(5000),
    expectNote: "Opening RM40,000: Day 7 cash RM10,000… exactly at reserve (no breach); Day 9: 10000+20000-15000=15000? Recompute in checker.",
  });
  // Correct case-18 arithmetic: opening 40,000; Day7: -25,000 -5,000 → 10,000 (not < 10,000 → no breach);
  // Day9: +20,000 -15,000 → 15,000 (no breach). So actually no breach at all!
  // To make a real "later breach" case: opening 35,000 → Day7: 5,000 (breach), Day9: 5,000+20,000-15,000=10,000 (no breach)… that's an early breach.
  // Better: opening 40,000, payroll Day 7 -25,000, part -5,000 → 10,000 (OK), Day 9 deferred -15,000 but receipt only +5,000 → 0 → breach on Day 9.
  cases[17].events = caseEvents([
    ev("c18-rcp", "Customer receipt", "receipt", RM(5000), 9, "Customer A"),
    ev("c18-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
    ev("c18-sup-a", "Supplier payment (part)", "supplier_payment", -RM(5000), 7, "Supplier B"),
    ev("c18-sup-b", "Supplier payment (deferred part)", "supplier_payment", -RM(15000), 9, "Supplier B", { note: "Subject to supplier agreement" }),
  ]);
  cases[17].expectFirstBreachDay = 9;
  cases[17].expectedMinSen = RM(0);
  cases[17].expectNote = "Day 7 cash RM10,000 (no breach); Day 9: 10,000+5,000-15,000=RM0 → later breach on Day 9.";

  // 19. Multiple receipts and obligations over 30 days.
  cases.push({
    id: "case-19",
    name: "Busy 30-day operation",
    description: "Several receipts and bills across the month.",
    category: "normal",
    openingCashSen: RM(60000), minimumReserveSen: RM(15000), horizon: H,
    events: caseEvents([
      ev("c19-r1", "Receipt 1", "receipt", RM(12000), 2, "Customer A"),
      ev("c19-b1", "Rent", "operating_expense", -RM(8000), 3, "Landlord"),
      ev("c19-r2", "Receipt 2", "receipt", RM(9000), 9, "Customer B"),
      ev("c19-pay1", "Payroll", "payroll", -RM(22000), 10, "Payroll"),
      ev("c19-r3", "Receipt 3", "receipt", RM(18000), 16, "Customer C"),
      ev("c19-b2", "Tax instalment", "tax", -RM(6000), 20, "LHDN"),
      ev("c19-r4", "Receipt 4", "receipt", RM(11000), 24, "Customer A"),
      ev("c19-pay2", "Payroll", "payroll", -RM(22000), 25, "Payroll"),
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "No breach across the full 30-day horizon.",
  });

  // 20. No reserve breach throughout the horizon.
  cases.push({
    id: "case-20",
    name: "Comfortable cash position",
    description: "Large buffer, no breach anywhere.",
    category: "normal",
    openingCashSen: RM(120000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c20-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c20-sup", "Supplier payment", "supplier_payment", -RM(30000), 14, "Supplier B"),
    ]),
    expectBreach: false, expectFirstBreachDay: null, expectedMinSen: RM(65000),
    expectNote: "Minimum RM65,000 — no breach.",
  });

  // 21. Breach occurring exactly on Day 30.
  cases.push({
    id: "case-21",
    name: "Breach on Day 30",
    description: "Final loan instalment pushes cash just below reserve on the last day.",
    category: "boundary",
    openingCashSen: RM(22000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c21-loan", "Final loan instalment", "loan_payment", -RM(12001), 30, "Bank"),
    ]),
    expectBreach: true, expectFirstBreachDay: 30, expectedMinSen: RM(9999),
    expectNote: "Day 30 cash RM9,999 — breach detected on the horizon edge.",
  });

  // 22. Multi-event change: receipt moved AND bill date changed together (independent case).
  cases.push({
    id: "case-22",
    name: "Simultaneous receipt delay and bill reschedule",
    description: "Receipt +5 days, supplier +5 days — net effect neutral.",
    category: "ordering",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c22-rcp", "Customer receipt", "receipt", RM(20000), 10, "Customer A"),
      ev("c22-pay", "Payroll", "payroll", -RM(25000), 7, "Payroll"),
      ev("c22-sup", "Supplier payment", "supplier_payment", -RM(20000), 12, "Supplier B"),
    ]),
    expectBreach: false, expectFirstBreachDay: null, expectedMinSen: RM(25000),
    expectNote: "Day 7 RM25,000; Day 12 RM25,000 — no breach (bill rescheduled with the receipt).",
  });

  // 23. Invalid date and invalid amount validation.
  cases.push({
    id: "case-23",
    name: "Invalid date and amount",
    description: "Bad ISO date and non-integer amount are reported, never dropped silently.",
    category: "validation",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: [
      { ...ev("c23-bad1", "Corrupted record", "other", Number.NaN, 5, "X"), dueDate: "2026-02-30", expectedDate: "2026-02-30" },
      { ...ev("c23-bad2", "Bad amount", "other", 1234.56, 6, "X") },
    ],
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "validateLedger reports ≥2 errors; corrupted-date event excluded from math; still present in ledger.",
  });

  // 24. Transaction correction removes a duplicate alert.
  cases.push({
    id: "case-24",
    name: "Correction clears duplicate alert",
    description: "Cancelling one of two identical records clears the finding.",
    category: "duplicate",
    openingCashSen: RM(50000), minimumReserveSen: RM(10000), horizon: H,
    events: caseEvents([
      ev("c24-sup1", "Supplier payment", "supplier_payment", -RM(8000), 6, "Vendor D", { invoiceRef: "VD-2001" }),
      { ...ev("c24-sup2", "Supplier payment", "supplier_payment", -RM(8000), 6, "Vendor D", { invoiceRef: "VD-2001" }), status: "cancelled" },
    ]),
    expectBreach: false, expectFirstBreachDay: null,
    expectNote: "With one record cancelled, no duplicate finding is raised.",
  });

  return cases;
}

export interface CaseRunResult {
  caseId: string;
  name: string;
  category: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/** Run every synthetic case against the REAL engine. No hardcoding. */
export function runSyntheticCases(): CaseRunResult[] {
  const cases = buildSyntheticCases();
  const results: CaseRunResult[] = [];
  for (const c of cases) {
    let actual = "";
    let pass = false;
    const engine = runEngine({
      openingCashSen: c.openingCashSen,
      minimumReserveSen: c.minimumReserveSen,
      horizonDays: c.horizon,
      events: c.events,
      anchorDate: DEMO_ANCHOR_DATE,
    });
    switch (c.id) {
      case "case-10":
      case "case-11":
      case "case-12":
      case "case-24": {
        const dup = detectDuplicateInvoices(c.events);
        if (c.id === "case-10") {
          pass = dup.length === 1 && dup[0].kind === "exact" && dup[0].eventIds.length === 2;
          actual = `${dup.length} finding(s), kind=${dup[0]?.kind ?? "none"}`;
        } else if (c.id === "case-11") {
          pass = dup.length === 1 && dup[0].kind === "near";
          actual = `${dup.length} finding(s), kind=${dup[0]?.kind ?? "none"}`;
        } else if (c.id === "case-12") {
          pass = dup.length === 0;
          actual = `${dup.length} finding(s)`;
        } else {
          pass = dup.length === 0;
          actual = `${dup.length} finding(s) after cancelling one record`;
        }
        break;
      }
      case "case-13": {
        const history = [
          { id: "h1", vendor: "Steady Vendor", category: "general", amountSen: -RM(5000), date: "2026-07-01" },
          { id: "h2", vendor: "Steady Vendor", category: "general", amountSen: -RM(5200), date: "2026-08-01" },
          { id: "h3", vendor: "Steady Vendor", category: "general", amountSen: -RM(4800), date: "2026-09-01" },
          { id: "h4", vendor: "Steady Vendor", category: "general", amountSen: -RM(5100), date: "2026-10-01" },
        ];
        const candidate = c.events[0];
        const r = detectUnusualCharges(history, candidate);
        pass = r.unusual && r.method === "robust_statistical";
        actual = `${r.unusual ? "flagged" : "not flagged"} via ${r.method}`;
        break;
      }
      case "case-14": {
        const history = [
          { id: "f1", vendor: "Tenant Cafe", category: "supplies", amountSen: RM(3000), date: "2026-06-01" },
          { id: "f2", vendor: "Tenant Cafe", category: "supplies", amountSen: RM(3200), date: "2026-06-20" },
          { id: "f3", vendor: "Tenant Cafe", category: "supplies", amountSen: RM(3100), date: "2026-07-25" },
          { id: "f4", vendor: "Tenant Cafe", category: "supplies", amountSen: RM(3050), date: "2026-08-30" },
        ];
        const f = forecastRecurringBill(history, "Tenant Cafe", "supplies");
        pass = f.pointEstimateSen !== null && f.evidence !== "low";
        actual = `estimate ${formatMYR(f.pointEstimateSen ?? 0)}, evidence=${f.evidence}`;
        break;
      }
      case "case-15": {
        const history = [
          { id: "g1", vendor: "New Vendor", category: "supplies", amountSen: RM(900), date: "2026-09-01" },
          { id: "g2", vendor: "New Vendor", category: "supplies", amountSen: RM(1100), date: "2026-09-20" },
        ];
        const f = forecastRecurringBill(history, "New Vendor", "supplies");
        pass = f.method === "insufficient_history" && f.evidence === "low" && f.pointEstimateSen === RM(1000);
        actual = `method=${f.method}, evidence=${f.evidence}, estimate=${formatMYR(f.pointEstimateSen ?? 0)}`;
        break;
      }
      case "case-16": {
        const history = [
          { id: "x1", vendor: "Outlier Co", category: "supplies", amountSen: RM(5000), date: "2026-05-01" },
          { id: "x2", vendor: "Outlier Co", category: "supplies", amountSen: RM(5000), date: "2026-06-01" },
          { id: "x3", vendor: "Outlier Co", category: "supplies", amountSen: RM(5200), date: "2026-07-01" },
          { id: "x4", vendor: "Outlier Co", category: "supplies", amountSen: RM(5100), date: "2026-08-01" },
          { id: "x5", vendor: "Outlier Co", category: "supplies", amountSen: RM(4900), date: "2026-09-01" },
          { id: "x6", vendor: "Outlier Co", category: "supplies", amountSen: RM(80000), date: "2026-10-01" },
        ];
        const f = forecastRecurringBill(history, "Outlier Co", "supplies");
        pass =
          f.outlierIds.includes("x6") &&
          f.pointEstimateSen !== null &&
          f.pointEstimateSen < RM(10000) &&
          f.method === "robust_median_trimmed";
        actual = `outliers=[${f.outlierIds.join(",")}], estimate=${formatMYR(f.pointEstimateSen ?? 0)}, method=${f.method}`;
        break;
      }
      case "case-23": {
        const errs = engine.validationIssues.filter((i) => i.severity === "error");
        const badDateExcluded = !engine.daily.some((d) => d.appliedEventIds.includes("c23-bad1"));
        const badAmountExcluded = !engine.daily.some((d) => d.appliedEventIds.includes("c23-bad2"));
        pass = errs.length >= 2 && badDateExcluded && badAmountExcluded;
        actual = `${errs.length} validation error(s); invalid events excluded from arithmetic but retained in ledger`;
        break;
      }
      default: {
        const minSen = engine.minBalanceSen;
        const breach = engine.breachEpisodes.length > 0;
        const firstDay = engine.firstBreachDay;
        const breachOK = breach === c.expectBreach && (c.expectBreach ? firstDay === c.expectFirstBreachDay : true);
        const minOK = c.expectedMinSen === undefined ? true : minSen === c.expectedMinSen;
        pass = breachOK && minOK;
        actual = `firstBreachDay=${firstDay ?? "none"}, minBalance=${formatMYR(minSen)} on Day ${engine.minDay}`;
      }
    }
    results.push({
      caseId: c.id,
      name: c.name,
      category: c.category,
      expected: c.expectNote,
      actual,
      pass,
    });
  }
  return results;
}
