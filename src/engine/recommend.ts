/**
 * MADANI Twin — Explainable Recommendations
 * -----------------------------------------
 * Exactly three primary decision labels: APPROVE / HOLD / REVIEW.
 * Decision-support labels only — never payment instructions.
 *
 * A payment is never APPROVE merely because current cash is sufficient:
 * the full projected trajectory and unresolved alerts are evaluated.
 */
import type { LedgerEvent, RiskAlert, Recommendation, EngineResult, ScenarioState } from "./types";
import type { ScenarioOp } from "./types";
import { runScenario, type BaselineDefinition } from "./scenarios";
import { formatMYR } from "./money";

export interface RecommendContext {
  scenario: ScenarioState;
  baseline: BaselineDefinition;
  alerts: RiskAlert[];
  supplierAgreementConfirmed: boolean;
}

/**
 * Build recommendations for all unpaid outflows in the scenario.
 * Priority order for decision:
 * 1. REVIEW if tied to duplicate/unusual/data-quality alerts.
 * 2. HOLD if paying it is projected to cause or worsen a reserve breach
 *    under the current scenario (checked by simulating removal of the payment).
 * 3. APPROVE otherwise.
 */
export function recommendAction(ctx: RecommendContext): Recommendation[] {
  const { scenario, baseline, alerts } = ctx;
  const engine = scenario.engine;
  const outflows = scenario.ledger.filter(
    (e) =>
      e.amountSen < 0 &&
      e.status !== "cancelled" &&
      e.eventType !== "payroll"
  );

  const recs: Recommendation[] = [];
  for (const ev of outflows) {
    const linkedAlerts = alerts.filter(
      (a) => a.relatedEventIds.includes(ev.id) && !a.resolved
    );
    const dupAlert = linkedAlerts.find(
      (a) => a.category === "duplicate_invoice" || a.category === "unusual_invoice" || a.category === "expense_shock"
    );
    const dqAlert = linkedAlerts.find((a) => a.category === "data_quality");

    // Simulate: what if this payment were postponed beyond the horizon
    // (i.e. removed)? If that removes all breaches, the payment itself
    // is the marginal cause of the breach under this scenario.
    const withoutOp: ScenarioOp = { kind: "change_amount", eventId: ev.id, newAmountSen: 0 };
    const without = runScenario(baseline, "_probe", "probe", "", [...scenario.ops, withoutOp]);
    const removesAllBreaches =
      engine.breachEpisodes.length > 0 && without.engine.breachEpisodes.length === 0;

    const reasons: string[] = [];
    let decision: Recommendation["decision"];
    let suggestedAction: string | null = null;
    let actionPreview: Recommendation["actionPreview"];

    if (dupAlert) {
      decision = "REVIEW";
      reasons.push(dupAlert.explanation);
      suggestedAction = "Verify with the vendor before paying; resolve the duplicate flag in the ledger first.";
    } else if (dqAlert) {
      decision = "REVIEW";
      reasons.push(dqAlert.explanation);
      suggestedAction = "Correct the invalid ledger record, then re-check this recommendation.";
    } else if (removesAllBreaches) {
      decision = "HOLD";
      const first = engine.breachEpisodes[0];
      reasons.push(
        `Paying ${formatMYR(ev.amountSen)} on ${ev.expectedDate} is projected to push closing cash to ${formatMYR(first.minBalanceSen)} on Day ${first.minDay} — ${formatMYR(first.maxShortfallSen)} below the ${formatMYR(engine.minimumReserveSen)} minimum reserve.`
      );
      reasons.push(`Removing this single payment eliminates every projected breach within the ${engine.horizonDays}-day horizon.`);
      suggestedAction = `Postpone part of this payment (e.g. defer RM10,000) or negotiate terms with ${ev.vendorOrCustomer}, conditional on supplier agreement.`;
      // Preview a half-deferral to +7 days after the original date (bounded by horizon).
      const origDay = ev.dayIndex ?? 0;
      const deferDay = Math.min(origDay + 7, engine.horizonDays);
      const deferSen = Math.min(Math.abs(ev.amountSen), 1_000_000);
      if (deferSen > 0 && deferSen < Math.abs(ev.amountSen)) {
        const preview = runScenario(baseline, "_probe2", "probe2", "", [
          ...scenario.ops,
          { kind: "split_postpone", eventId: ev.id, deferSen: -deferSen, newDay: deferDay },
        ]);
        actionPreview = {
          description: `Test: defer ${formatMYR(-deferSen)} of this payment to Day ${deferDay} (subject to supplier agreement).`,
          newDay7CashSen: preview.engine.daily.find((d) => d.day === 7)?.closingSen,
          newMinBalanceSen: preview.engine.minBalanceSen,
          breachesRemaining: preview.engine.breachEpisodes.length,
        };
      }
    } else {
      decision = "APPROVE";
      const minAfter = engine.minBalanceSen;
      reasons.push(
        `With this payment, projected minimum cash stays at ${formatMYR(minAfter)} through Day ${engine.horizonDays}, above the ${formatMYR(engine.minimumReserveSen)} reserve.`
      );
      const breachFree = engine.breachEpisodes.length === 0;
      if (breachFree) {
        reasons.push("No projected reserve breaches and no unresolved data-quality or duplication alerts on this transaction.");
      }
    }

    // Supplier agreement note for any deferred-supplier scenario.
    if (
      ev.eventType === "supplier_payment" &&
      (ev.note ?? "").includes("supplier agreement") &&
      !ctx.supplierAgreementConfirmed
    ) {
      reasons.push("Supplier agreement has NOT been confirmed — this schedule is conditional until you record the supplier's confirmation.");
    }

    recs.push({
      eventId: ev.id,
      description: ev.description,
      decision,
      reasons,
      projectedDay: engine.breachEpisodes[0]?.startDay ?? null,
      suggestedAction,
      actionPreview,
    });
  }
  return recs;
}
