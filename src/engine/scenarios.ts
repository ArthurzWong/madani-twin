/**
 * MADANI Twin — Scenario Engine
 * -----------------------------
 * Applies a list of ScenarioOps on top of the BASELINE ledger without ever
 * mutating the baseline. Every scenario is a fresh projection.
 *
 * Key mechanics:
 * - move_event: MOVES the original event (never duplicates a receipt).
 * - change_amount / add_expense / add_receipt: explicit ops.
 * - split_postpone: splits part of a payment to a later day (two events, no double count).
 * - restore_event: removes prior ops on that event (back to baseline state).
 * - set_reserve: changes the reserve used for this scenario.
 */
import type { LedgerEvent, ScenarioOp, ScenarioState } from "./types";
import { runEngine } from "./core";
import { buildBaselineLedger, DEMO_ANCHOR_DATE, DEMO_OPENING_SEN, DEMO_RESERVE_SEN, DEMO_HORIZON, isoForDayPublic } from "./demoScenario";

export interface BaselineDefinition {
  ledger: LedgerEvent[];
  openingCashSen: number;
  minimumReserveSen: number;
  horizonDays: number;
  anchorDate: string;
  name: string;
}

export function buildDemoBaseline(): BaselineDefinition {
  return {
    ledger: buildBaselineLedger(),
    openingCashSen: DEMO_OPENING_SEN,
    minimumReserveSen: DEMO_RESERVE_SEN,
    horizonDays: DEMO_HORIZON,
    anchorDate: DEMO_ANCHOR_DATE,
    name: "Baseline",
  };
}

/** Deep-clone a ledger and apply ops. Pure w.r.t. inputs. */
export function applyOps(baseline: BaselineDefinition, ops: ScenarioOp[]): LedgerEvent[] {
  let ledger: LedgerEvent[] = structuredClone(baseline.ledger);
  for (const op of ops) {
    ledger = applySingleOp(ledger, op, baseline);
  }
  return ledger;
}

function applySingleOp(ledger: LedgerEvent[], op: ScenarioOp, baseline: BaselineDefinition): LedgerEvent[] {
  switch (op.kind) {
    case "move_event": {
      const target = ledger.find((e) => e.id === op.eventId);
      if (target) {
        const date = isoForDayPublic(op.newDay, baseline.anchorDate);
        target.expectedDate = date;
        target.dueDate = date;
        target.dayIndex = op.newDay;
        target.dataClass = "scenario";
        target.source = "scenario_assumption";
        target.dupMeta = target.dupMeta
          ? { ...target.dupMeta, invoiceDate: date }
          : undefined;
      }
      return ledger;
    }
    case "change_amount": {
      const target = ledger.find((e) => e.id === op.eventId);
      if (target) {
        target.amountSen = op.newAmountSen;
        target.dataClass = "scenario";
        target.source = "scenario_assumption";
        if (target.dupMeta) target.dupMeta.amountKey = String(op.newAmountSen);
      }
      return ledger;
    }
    case "add_expense":
    case "add_receipt": {
      const date = isoForDayPublic(op.day, baseline.anchorDate);
      const id = `scn-${op.kind === "add_expense" ? "exp" : "rcp"}-${op.day}-${Math.abs(op.amountSen)}-${ledger.length}`;
      const vendorName = op.kind === "add_expense" ? (op.vendor ?? "Scenario expense") : (op.customer ?? "Scenario customer");
      const ev: LedgerEvent = {
        id,
        businessId: "scenario",
        description: op.description,
        eventType: op.kind === "add_expense" ? "other" : "receipt",
        amountSen: op.amountSen,
        dueDate: date,
        expectedDate: date,
        status: "forecasted",
        vendorOrCustomer: vendorName,
        recurrence: "none",
        source: "scenario_assumption",
        dataClass: "scenario",
        dayIndex: op.day,
        dupMeta: {
          normalizedDescription: op.description.toLowerCase().trim(),
          amountKey: String(op.amountSen),
          invoiceDate: date,
        },
        note: "Scenario-generated event",
      };
      return [...ledger, ev];
    }
    case "split_postpone": {
      const idx = ledger.findIndex((e) => e.id === op.eventId);
      if (idx === -1) return ledger;
      const target = ledger[idx];
      if (Math.abs(op.deferSen) > Math.abs(target.amountSen)) return ledger; // cannot defer more than the bill
      const payNow = target.amountSen - op.deferSen; // deferSen negative -> subtracting it leaves the pay-now part
      const nowPart: LedgerEvent = {
        ...structuredClone(target),
        amountSen: payNow,
        note: `Part payment (deferred ${Math.abs(op.deferSen) / 100} RM to Day ${op.newDay}, subject to supplier agreement)`,
        dataClass: "scenario",
        source: "scenario_assumption",
      };
      const date = isoForDayPublic(op.newDay, baseline.anchorDate);
      const laterPart: LedgerEvent = {
        ...structuredClone(target),
        id: `${target.id}-defer`,
        description: `${target.description} — deferred portion`,
        amountSen: op.deferSen, // negative
        dueDate: date,
        expectedDate: date,
        dayIndex: op.newDay,
        status: "pending",
        note: "Subject to supplier agreement — not yet confirmed",
        dataClass: "scenario",
        source: "scenario_assumption",
      };
      const next = [...ledger];
      next[idx] = nowPart;
      next.splice(idx + 1, 0, laterPart);
      return next;
    }
    case "restore_event": {
      // Remove all scenario mutations for this event: re-clone from baseline,
      // drop derived events (e.g. -defer) that were created from it.
      const original = baseline.ledger.find((e) => e.id === op.eventId);
      if (!original) return ledger;
      const cleaned = ledger.filter(
        (e) => e.id !== op.eventId && !e.id.startsWith(op.eventId + "-")
      );
      return [...cleaned, structuredClone(original)];
    }
    case "set_reserve": {
      // handled at scenario level, not ledger level
      return ledger;
    }
  }
}

export function runScenario(
  baseline: BaselineDefinition,
  id: string,
  name: string,
  description: string,
  ops: ScenarioOp[]
): ScenarioState {
  let reserve = baseline.minimumReserveSen;
  for (const op of ops) {
    if (op.kind === "set_reserve") reserve = op.newReserveSen;
  }
  const ledger = applyOps(baseline, ops);
  const engine = runEngine({
    openingCashSen: baseline.openingCashSen,
    minimumReserveSen: reserve,
    horizonDays: baseline.horizonDays,
    events: ledger,
    anchorDate: baseline.anchorDate,
  });
  return {
    id,
    name,
    description,
    ops,
    ledger,
    engine,
    openingCashSen: baseline.openingCashSen,
    minimumReserveSen: reserve,
  };
}
