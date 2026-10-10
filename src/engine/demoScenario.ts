/**
 * MADANI Twin — Demo Scenario Factory
 * -----------------------------------
 * Mandatory reproducible scenario (Dormathon 2026 Track 1):
 * Day 0 opening cash RM50,000; minimum reserve RM10,000.
 * Day 5: +RM20,000 receipt. Day 7: -RM25,000 payroll, -RM20,000 supplier.
 *
 * The anchor date is fixed (2026-11-01) so demo runs are identical every time.
 */
import type { LedgerEvent, LedgerEventType, SourceLabel, DataClass } from "./types";

export const DEMO_ANCHOR_DATE = "2026-11-01"; // Day 0
export const DEMO_OPENING_SEN = 5_000_000;    // RM50,000.00
export const DEMO_RESERVE_SEN = 1_000_000;    // RM10,000.00
export const DEMO_HORIZON = 30;
export const DEMO_BUSINESS_ID = "demo-warung-kedai";

let counter = 0;
export function resetIdCounter(): void {
  counter = 0;
}
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(3, "0")}`;
}

export function isoForDayPublic(day: number, anchor: string = DEMO_ANCHOR_DATE): string {
  const d = new Date(anchor + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export function makeEvent(opts: {
  id?: string;
  description: string;
  eventType: LedgerEventType;
  amountSen: number;
  day: number;
  vendorOrCustomer: string;
  source?: SourceLabel;
  dataClass?: DataClass;
  status?: LedgerEvent["status"];
  note?: string;
  invoiceRef?: string;
  anchor?: string;
  businessId?: string;
}): LedgerEvent {
  const anchor = opts.anchor ?? DEMO_ANCHOR_DATE;
  const date = isoForDayPublic(opts.day, anchor);
  return {
    id: opts.id ?? nextId("evt"),
    businessId: opts.businessId ?? DEMO_BUSINESS_ID,
    description: opts.description,
    eventType: opts.eventType,
    amountSen: opts.amountSen,
    dueDate: date,
    expectedDate: date,
    status: opts.status ?? "confirmed",
    vendorOrCustomer: opts.vendorOrCustomer,
    recurrence: "none",
    source: opts.source ?? "synthetic_demo",
    dataClass: opts.dataClass ?? "known",
    invoiceRef: opts.invoiceRef,
    note: opts.note,
    dayIndex: opts.day,
    dupMeta: {
      normalizedDescription: opts.description.toLowerCase().replace(/\s+/g, " ").trim(),
      amountKey: String(opts.amountSen),
      invoiceDate: date,
    },
  };
}

export interface DemoEvents {
  receipt: LedgerEvent;      // +RM20,000 Day 5
  payroll: LedgerEvent;      // -RM25,000 Day 7
  supplier: LedgerEvent;     // -RM20,000 Day 7
}

/** The three baseline events, with stable ids. */
export function buildDemoEvents(): DemoEvents {
  resetIdCounter();
  const receipt = makeEvent({
    id: "demo-receipt-001",
    description: "Customer receipt — Gopeng Trading Sdn Bhd (invoice INV-2041)",
    eventType: "receipt",
    amountSen: 2_000_000,
    day: 5,
    vendorOrCustomer: "Gopeng Trading Sdn Bhd",
    invoiceRef: "INV-2041",
  });
  const payroll = makeEvent({
    id: "demo-payroll-001",
    description: "Monthly payroll — 9 staff",
    eventType: "payroll",
    amountSen: -2_500_000,
    day: 7,
    vendorOrCustomer: "Internal payroll",
  });
  const supplier = makeEvent({
    id: "demo-supplier-001",
    description: "Supplier payment — Syarikat Bekalan Utama (invoice SBU-8817)",
    eventType: "supplier_payment",
    amountSen: -2_000_000,
    day: 7,
    vendorOrCustomer: "Syarikat Bekalan Utama",
    invoiceRef: "SBU-8817",
  });
  return { receipt, payroll, supplier };
}

/** Baseline ledger (deep copy per call so callers can't share state). */
export function buildBaselineLedger(): LedgerEvent[] {
  const { receipt, payroll, supplier } = buildDemoEvents();
  return [structuredClone(receipt), structuredClone(payroll), structuredClone(supplier)];
}

export const DEMO_CONSTANTS = {
  baselineDay0Sen: 5_000_000,
  baselineDay5Sen: 7_000_000,
  baselineDay7Sen: 2_500_000,
  downsideDay7Sen: 500_000,
  downsideShortfallSen: 500_000,
  interventionDay7Sen: 1_500_000,
  interventionDay9Sen: 2_500_000,
  interventionDay30Sen: 2_500_000,
  leadTimeDays: 7,
};
