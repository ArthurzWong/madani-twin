/**
 * MADANI Twin — Evaluation Metrics
 * --------------------------------
 * Genuine metrics computed from reproducible evaluation cases.
 * All denominators are explicit; zero denominators return null and the UI
 * reports them honestly rather than showing a fake number.
 */
import type { EngineResult } from "./types";
import { runEngine } from "./core";
import type { EvalCase } from "./types";
import type { BaselineDefinition } from "./scenarios";
import { formatMYR } from "./money";

export interface DetectionCounts {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

/**
 * Detection evaluation over cases.
 * True positive:   actual breach within horizon AND a breach alert raised.
 * False negative:  actual breach within horizon AND no alert.
 * False positive:  no actual breach AND alert raised.
 * True negative:   no actual breach AND no alert.
 * The alert function is passed in to avoid circular imports.
 */
export function evaluateDetection(
  cases: EvalCase[],
  detect: (engine: EngineResult) => boolean
): DetectionCounts {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    const engine = runEngine({
      openingCashSen: c.openingCashSen,
      minimumReserveSen: c.minimumReserveSen,
      horizonDays: c.horizon,
      events: c.events,
      anchorDate: "2026-11-01",
    });
    const actualBreach = engine.breachEpisodes.length > 0;
    const warned = detect(engine);
    if (actualBreach && warned) tp++;
    else if (actualBreach && !warned) fn++;
    else if (!actualBreach && warned) fp++;
    else tn++;
  }
  return { tp, fp, fn, tn };
}

/** Recall = TP / (TP + FN). null when denominator is zero (honest). */
export function recall(counts: DetectionCounts): number | null {
  const denom = counts.tp + counts.fn;
  return denom === 0 ? null : counts.tp / denom;
}

/** False-positive rate = FP / (FP + TN). null when denominator is zero. */
export function falsePositiveRate(counts: DetectionCounts): number | null {
  const denom = counts.fp + counts.tn;
  return denom === 0 ? null : counts.fp / denom;
}

/**
 * Lead-time distribution across detected breach cases: for each case with an
 * actual breach that was detected, lead = firstBreachDay - detectionDay(=0).
 * Here detection is at Day 0 (engine projects forward from the current day),
 * so lead time equals the first projected breach day.
 */
export function leadTimeDistribution(
  cases: EvalCase[]
): Array<{ caseId: string; leadDays: number }> {
  const out: Array<{ caseId: string; leadDays: number }> = [];
  for (const c of cases) {
    const engine = runEngine({
      openingCashSen: c.openingCashSen,
      minimumReserveSen: c.minimumReserveSen,
      horizonDays: c.horizon,
      events: c.events,
      anchorDate: "2026-11-01",
    });
    if (engine.breachEpisodes.length > 0 && engine.firstBreachDay !== null) {
      out.push({ caseId: c.id, leadDays: engine.firstBreachDay });
    }
  }
  return out;
}

/** Forecast MAE between predicted and actual daily balances on evaluated days. */
export function balanceMAE(predicted: EngineResult, actual: EngineResult): number | null {
  if (predicted.daily.length !== actual.daily.length) return null;
  let sum = 0;
  for (let i = 0; i < predicted.daily.length; i++) {
    sum += Math.abs(predicted.daily[i].closingSen - actual.daily[i].closingSen);
  }
  return sum / predicted.daily.length;
}

export interface InterventionEffectiveness {
  breachEliminated: boolean;
  minBalanceBeforeSen: number;
  minBalanceAfterSen: number;
  breachDaysBefore: number;
  breachDaysAfter: number;
  laterBreachAfterIntervention: boolean;
  /** Improvement in minimum balance (sen). */
  minBalanceImprovementSen: number;
}

/** Compare downside vs intervention scenarios. */
export function interventionEffectiveness(
  downside: EngineResult,
  intervention: EngineResult
): InterventionEffectiveness {
  const breachDays = (e: EngineResult) => e.daily.filter((d) => d.isBreach).length;
  return {
    breachEliminated:
      downside.breachEpisodes.length > 0 && intervention.breachEpisodes.length === 0,
    minBalanceBeforeSen: downside.minBalanceSen,
    minBalanceAfterSen: intervention.minBalanceSen,
    breachDaysBefore: breachDays(downside),
    breachDaysAfter: breachDays(intervention),
    laterBreachAfterIntervention: intervention.breachEpisodes.length > 0,
    minBalanceImprovementSen: intervention.minBalanceSen - downside.minBalanceSen,
  };
}

/** Compare three scenarios for the overview panel. */
export function compareScenarios(
  baseline: EngineResult,
  downside: EngineResult,
  intervention: EngineResult
): {
  baseline: { minSen: number; minDay: number; breaches: number; day30Sen: number };
  downside: { minSen: number; minDay: number; breaches: number; day30Sen: number };
  intervention: { minSen: number; minDay: number; breaches: number; day30Sen: number };
} {
  const summarize = (e: EngineResult) => ({
    minSen: e.minBalanceSen,
    minDay: e.minDay,
    breaches: e.breachEpisodes.length,
    day30Sen: e.daily[e.daily.length - 1]?.closingSen ?? e.openingCashSen,
  });
  return {
    baseline: summarize(baseline),
    downside: summarize(downside),
    intervention: summarize(intervention),
  };
}
