/**
 * MADANI Twin — Payment Guardian
 * ------------------------------
 * Explainable risk detection over a scenario's engine output.
 * Every alert carries severity, evidence class, contributing transactions,
 * predicted date/cash/shortfall and a suggested next action.
 */
import type { LedgerEvent, RiskAlert, EngineResult, BreachEpisode } from "./types";
import type { BaselineDefinition } from "./scenarios";
import { median, mad, MAD_SIGMA_FACTOR } from "./guardianDeps";

const ANCHOR = "2026-11-01";

export interface GuardianContext {
  scenarioName: string;
  engine: EngineResult;
  ledger: LedgerEvent[];
  baseline: BaselineDefinition;
  /** Receipts that were delayed relative to their original expected date. */
  delayedReceiptIds: string[];
  /** Whether a supplier agreement has been explicitly confirmed by the user. */
  supplierAgreementConfirmed: boolean;
}

function isoForDay(day: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export function isoForDayExport(day: number): string {
  return isoForDay(day);
}

/**
 * Duplicate invoice detection.
 * - Exact duplicates: same invoiceRef (non-empty) + vendor + amount, or
 *   identical vendor+amount+date+normalized description.
 * - Possible near-duplicates: same vendor + amount + dates within 14 days
 *   but different invoice refs — flagged for REVIEW, never auto-labelled fraud.
 * Repeated vendor+amount alone (different months/refs) is NOT a duplicate.
 */
export interface DuplicateFinding {
  kind: "exact" | "near";
  eventIds: string[];
  reason: string;
}

export function detectDuplicateInvoices(events: LedgerEvent[]): DuplicateFinding[] {
  const outflows = events.filter(
    (e) => e.amountSen < 0 && e.status !== "cancelled" && e.eventType !== "payroll"
  );
  const findings: DuplicateFinding[] = [];
  const used = new Set<string>();

  // Pass 1: exact — same invoiceRef + vendor + amount.
  const byRef = new Map<string, LedgerEvent[]>();
  for (const e of outflows) {
    if (e.invoiceRef && e.invoiceRef.trim() !== "") {
      const key = `${e.vendorOrCustomer}::${e.invoiceRef.trim().toLowerCase()}::${e.amountSen}`;
      if (!byRef.has(key)) byRef.set(key, []);
      byRef.get(key)!.push(e);
    }
  }
  for (const [, group] of byRef) {
    if (group.length > 1) {
      findings.push({
        kind: "exact",
        eventIds: group.map((e) => e.id),
        reason: `Same invoice reference, vendor and amount (${group[0].invoiceRef}) recorded more than once.`,
      });
      group.forEach((e) => used.add(e.id));
    }
  }

  // Pass 2: exact — same vendor+amount+date+normalized description, no ref needed.
  const byTuple = new Map<string, LedgerEvent[]>();
  for (const e of outflows) {
    const key = `${e.vendorOrCustomer}::${e.amountSen}::${e.expectedDate}::${e.dupMeta?.normalizedDescription ?? e.description.toLowerCase()}`;
    if (!byTuple.has(key)) byTuple.set(key, []);
    byTuple.get(key)!.push(e);
  }
  for (const [, group] of byTuple) {
    if (group.length > 1 && !group.every((e) => used.has(e.id))) {
      findings.push({
        kind: "exact",
        eventIds: group.map((e) => e.id),
        reason: "Same vendor, amount, date and description recorded more than once.",
      });
      group.forEach((e) => used.add(e.id));
    }
  }

  // Pass 3: near-duplicates — same vendor+amount, dates within 14 days, different refs.
  for (let i = 0; i < outflows.length; i++) {
    for (let j = i + 1; j < outflows.length; j++) {
      const a = outflows[i];
      const b = outflows[j];
      if (used.has(a.id) || used.has(b.id)) continue;
      if (a.vendorOrCustomer !== b.vendorOrCustomer) continue;
      if (a.amountSen !== b.amountSen) continue;
      const da = Date.parse(a.expectedDate + "T00:00:00Z");
      const db = Date.parse(b.expectedDate + "T00:00:00Z");
      if (Number.isNaN(da) || Number.isNaN(db)) continue;
      const diff = Math.abs(da - db) / 86400000;
      if (diff === 0) continue; // same-day handled above
      if (diff <= 14) {
        const sameRef =
          a.invoiceRef && b.invoiceRef && a.invoiceRef.toLowerCase() === b.invoiceRef.toLowerCase();
        if (sameRef) continue; // already exact
        findings.push({
          kind: "near",
          eventIds: [a.id, b.id],
          reason: `Same vendor and amount (${(Math.abs(a.amountSen) / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })}) dated ${diff} day(s) apart with different references — verify before paying both.`,
        });
        used.add(a.id);
        used.add(b.id);
      }
    }
  }
  return findings;
}

/**
 * Unusual-charge detection.
 * With >= 4 comparable vendor history: robust 3-MAD-sigma rule.
 * Otherwise: rule-based heuristic vs configurable absolute/percentage threshold.
 */
export function detectUnusualCharges(
  history: Array<{ id: string; vendor: string; category: string; amountSen: number; date: string }>,
  candidate: LedgerEvent,
  opts?: { absoluteThresholdSen?: number; pctThreshold?: number }
): { unusual: boolean; method: "robust_statistical" | "rule_based_heuristic"; detail: string; zScore?: number } {
  const vendorHistory = history.filter(
    (h) => h.vendor === candidate.vendorOrCustomer && h.id !== candidate.id
  );
  const n = vendorHistory.length;
  if (n >= 4) {
    const values = vendorHistory.map((h) => Math.abs(h.amountSen));
    const med = median(values);
    const disp = mad(values);
    const sigma = 3 * MAD_SIGMA_FACTOR * disp;
    if (sigma > 0) {
      const candidateAbs = Math.abs(candidate.amountSen);
      const unusual = candidateAbs > med + sigma;
      const z = disp > 0 ? Math.abs(candidateAbs - med) / (MAD_SIGMA_FACTOR * disp) : 0;
      return {
        unusual,
        method: "robust_statistical",
        detail: unusual
          ? `Vendor median ${(med / 100).toFixed(0)} RM with robust dispersion ${(disp / 100).toFixed(0)} RM; this invoice exceeds the documented 3-MAD threshold.`
          : "Within the vendor's robust historical range.",
        zScore: z,
      };
    }
    // zero dispersion: any materially larger amount is unusual
    const candidateAbs = Math.abs(candidate.amountSen);
    const unusual = candidateAbs > med * 1.5 && candidateAbs - med > (opts?.absoluteThresholdSen ?? 500_00);
    return { unusual, method: "robust_statistical", detail: unusual ? "Vendor history is flat; this invoice is materially larger." : "Matches the vendor's flat history." };
  }
  const absThreshold = opts?.absoluteThresholdSen ?? 500_00; // RM500 default
  const pct = opts?.pctThreshold ?? 0.5; // +50% vs last observed
  const last = n > 0 ? Math.abs(vendorHistory[n - 1].amountSen) : null;
  const candidateAbs = Math.abs(candidate.amountSen);
  const unusual =
    candidateAbs >= absThreshold && (last === null || candidateAbs > last * (1 + pct));
  return {
    unusual,
    method: "rule_based_heuristic",
    detail: last === null
      ? "No vendor history — flagged by absolute-threshold heuristic only."
      : `Fewer than 4 observations; flagged when > +${Math.round(pct * 100)}% of the last observed amount (RM${(last / 100).toFixed(0)}).`,
  };
}

/** Main guardian scan: produce all alerts for a scenario. */
export function classifyRisk(ctx: GuardianContext): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const { engine, ledger } = ctx;

  // 1. Reserve breach alerts (one per episode).
  for (const ep of engine.breachEpisodes) {
    const contributors = ep.responsibleEventIds
      .map((id) => ledger.find((e) => e.id === id))
      .filter((e): e is LedgerEvent => !!e);
    alerts.push({
      id: `alert-breach-${ep.startDay}`,
      severity: "critical",
      category: "reserve_breach",
      title: `Projected reserve breach on Day ${ep.startDay}`,
      explanation: buildBreachExplanation(engine, ep, ctx),
      relatedEventIds: contributors.map((e) => e.id),
      predictedDay: ep.startDay,
      predictedDate: isoForDay(ep.startDay),
      predictedCashSen: ep.minBalanceSen,
      minimumReserveSen: engine.minimumReserveSen,
      amountBelowReserveSen: ep.maxShortfallSen,
      contributions: contributors.map((e) => ({ eventId: e.id, description: e.description, amountSen: e.amountSen })),
      suggestedAction:
        ep.maxShortfallSen > 0
          ? `Review payments due on or before Day ${ep.startDay}: consider postponing part of the largest supplier payment or accelerating the receivable.`
          : "No action needed.",
      evidence: ctx.scenarioName === "Baseline" ? "confirmed" : "scenario_dependent",
      scenarioDependent: ctx.scenarioName !== "Baseline",
      resolved: false,
    });
  }

  // 2. Delayed receipt alerts.
  for (const id of ctx.delayedReceiptIds) {
    const ev = ledger.find((e) => e.id === id);
    if (!ev) continue;
    alerts.push({
      id: `alert-delay-${id}`,
      severity: "warning",
      category: "delayed_receipt",
      title: `Receipt delayed: ${ev.vendorOrCustomer}`,
      explanation: buildDelayExplanation(ev, ctx),
      relatedEventIds: [ev.id],
      predictedDay: ev.dayIndex ?? null,
      predictedDate: ev.expectedDate,
      predictedCashSen: null,
      minimumReserveSen: engine.minimumReserveSen,
      amountBelowReserveSen: null,
      contributions: [{ eventId: ev.id, description: ev.description, amountSen: ev.amountSen }],
      suggestedAction: "Follow up with the customer on payment status; consider whether bills due before the new receipt date can be rescheduled.",
      evidence: "scenario_dependent",
      scenarioDependent: ctx.scenarioName !== "Baseline",
      resolved: false,
    });
  }

  // 3. Duplicate invoices.
  for (const f of detectDuplicateInvoices(ledger)) {
    alerts.push({
      id: `alert-dup-${f.eventIds.join("-")}`,
      severity: f.kind === "exact" ? "critical" : "warning",
      category: "duplicate_invoice",
      title: f.kind === "exact" ? "Possible duplicate invoice (exact match)" : "Possible near-duplicate invoice",
      explanation: f.reason + " This is a data-quality flag, not proof of fraud — verify with the vendor before cancelling either record.",
      relatedEventIds: f.eventIds,
      predictedDay: null,
      predictedDate: null,
      predictedCashSen: null,
      minimumReserveSen: engine.minimumReserveSen,
      amountBelowReserveSen: null,
      contributions: f.eventIds.map((id) => {
        const e = ledger.find((x) => x.id === id)!;
        return { eventId: id, description: e.description, amountSen: e.amountSen };
      }),
      suggestedAction: "Compare both records, confirm with the vendor, then cancel or correct the duplicate in the ledger.",
      evidence: "confirmed",
      scenarioDependent: false,
      resolved: false,
    });
  }

  // 4. Unusual charges / expense shock (outflows vs demo history).
  const history = ledger.filter((e) => e.amountSen < 0 && e.dayIndex !== undefined && e.dayIndex < 0) as Array<LedgerEvent & { dayIndex: number }>;
  const historyObs = history.map((e) => ({ id: e.id, vendor: e.vendorOrCustomer, category: "general", amountSen: e.amountSen, date: e.expectedDate }));
  for (const e of ledger) {
    if (e.amountSen >= 0 || e.status === "cancelled" || e.eventType === "payroll") continue;
    const r = detectUnusualCharges(historyObs, e, { absoluteThresholdSen: 2_500_000 });
    if (r.unusual) {
      alerts.push({
        id: `alert-unusual-${e.id}`,
        severity: "warning",
        category: r.method === "robust_statistical" ? "unusual_invoice" : "expense_shock",
        title: `Unusually large invoice: ${e.vendorOrCustomer}`,
        explanation: `${r.detail} Detection method: ${r.method === "robust_statistical" ? "documented robust statistical threshold (3-MAD sigma)" : "rule-based heuristic (absolute/percentage threshold)"}.`,
        relatedEventIds: [e.id],
        predictedDay: e.dayIndex ?? null,
        predictedDate: e.expectedDate,
        predictedCashSen: null,
        minimumReserveSen: engine.minimumReserveSen,
        amountBelowReserveSen: null,
        contributions: [{ eventId: e.id, description: e.description, amountSen: e.amountSen }],
        suggestedAction: "Verify the invoice with the vendor and confirm it matches an approved purchase order before payment.",
        evidence: r.method === "robust_statistical" ? "estimated" : "heuristic",
        scenarioDependent: ctx.scenarioName !== "Baseline",
        resolved: false,
      });
    }
  }

  // 5. Data-quality alerts from validation issues.
  const errs = engine.validationIssues.filter((i) => i.severity === "error");
  if (errs.length > 0) {
    alerts.push({
      id: "alert-data-quality",
      severity: "warning",
      category: "data_quality",
      title: `${errs.length} data issue(s) in the ledger`,
      explanation: errs.map((i) => i.message).join(" "),
      relatedEventIds: errs.map((i) => i.eventId),
      predictedDay: null,
      predictedDate: null,
      predictedCashSen: null,
      minimumReserveSen: engine.minimumReserveSen,
      amountBelowReserveSen: null,
      contributions: [],
      suggestedAction: "Fix the invalid records in the Cash Ledger so forecasts stay reliable.",
      evidence: "confirmed",
      scenarioDependent: false,
      resolved: false,
    });
  }

  return alerts;
}

function buildBreachExplanation(engine: EngineResult, ep: BreachEpisode, ctx: GuardianContext): string {
  const dayCash = engine.daily.find((d) => d.day === ep.startDay)?.closingSen ?? ep.minBalanceSen;
  const parts: string[] = [];
  parts.push(
    `Projected closing cash on Day ${ep.startDay} is ${(dayCash / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })}, which is ${(ep.maxShortfallSen / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })} below your ${(engine.minimumReserveSen / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })} minimum reserve.`
  );
  if (ep.responsibleEventIds.length > 0) {
    const evs = ep.responsibleEventIds
      .map((id) => ledgerFind(ctx.ledger, id))
      .filter(Boolean) as LedgerEvent[];
    const desc = evs.map((e) => `${e.description} (${e.amountSen < 0 ? "-" : "+"}${(Math.abs(e.amountSen) / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })})`).join("; ");
    parts.push(`Contributing transactions on the breach date: ${desc}.`);
  }
  return parts.join(" ");
}

function buildDelayExplanation(ev: LedgerEvent, ctx: GuardianContext): string {
  const amount = (Math.abs(ev.amountSen) / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" });
  const day = ev.dayIndex ?? "?";
  return `Your ${amount} customer receipt from ${ev.vendorOrCustomer} is now expected on Day ${day}. Payroll and supplier obligations remain due on their original dates. The scenario projects closing cash falls below the ${(ctx.engine.minimumReserveSen / 100).toLocaleString("en-MY", { style: "currency", currency: "MYR" })} reserve before this receipt arrives.`;
}

function ledgerFind(ledger: LedgerEvent[], id: string): LedgerEvent | undefined {
  return ledger.find((e) => e.id === id);
}
