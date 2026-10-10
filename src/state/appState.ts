/**
 * MADANI Twin — App State Layer
 * -----------------------------
 * Holds baseline + three mandatory scenarios + user scenario, recomputes
 * everything on any change, persists to localStorage with validation and
 * graceful recovery. Pure engine below; this is the single UI-facing store.
 */
import type { LedgerEvent, ScenarioOp, RiskAlert, Recommendation, TestCase, ScenarioState, EvalCase } from "../engine/types";
import { buildDemoBaseline, runScenario, type BaselineDefinition } from "../engine/scenarios";
import { runEngine } from "../engine/core";
import { classifyRisk } from "../engine/guardian";
import { recommendAction } from "../engine/recommend";
import { runFullSuite, buildMandatoryScenarios, generateForecastPairs } from "../engine/suite";
import { runSyntheticCases, buildSyntheticCases } from "../engine/syntheticCases";
import { forecastMAE, forecastRMSE } from "../engine/forecast";
import { evaluateDetection, recall, falsePositiveRate, leadTimeDistribution, interventionEffectiveness } from "../engine/evaluation";
import { formatMYR } from "../engine/money";
import { DEMO_ANCHOR_DATE } from "../engine/demoScenario";

export type ScenarioKey = "baseline" | "downside" | "intervention" | "custom";

export interface DelayedReceiptInfo {
  eventId: string;
  originalDay: number;
  newDay: number;
}

export interface AppState {
  baseline: BaselineDefinition;
  scenarios: Record<"baseline" | "downside" | "intervention", ScenarioState>;
  customOps: ScenarioOp[];
  custom: ScenarioState;
  selectedScenario: ScenarioKey;
  supplierAgreementConfirmed: boolean;
  lastUpdated: string;
}

const STORAGE_KEY = "madani-twin-state-v1";

export function computeCustom(baseline: BaselineDefinition, ops: ScenarioOp[]): ScenarioState {
  return runScenario(
    baseline,
    "custom",
    "Your scenario",
    ops.length === 0 ? "Same as baseline — add a what-if change." : `Custom scenario with ${ops.length} change(s).`,
    ops
  );
}

/** Detect receipts moved later vs baseline (for Payment Guardian alerts). */
export function findDelayedReceipts(scenario: ScenarioState, baseline: BaselineDefinition): DelayedReceiptInfo[] {
  const out: DelayedReceiptInfo[] = [];
  for (const ev of scenario.ledger) {
    if (ev.eventType !== "receipt") continue;
    const orig = baseline.ledger.find((e) => e.id === ev.id);
    if (!orig) continue;
    const origDay = orig.dayIndex ?? 0;
    const newDay = ev.dayIndex ?? 0;
    if (newDay > origDay) out.push({ eventId: ev.id, originalDay: origDay, newDay });
  }
  return out;
}

export interface AlertsBundle {
  alerts: RiskAlert[];
  delayed: DelayedReceiptInfo[];
}

export function computeAlerts(state: AppState, key: ScenarioKey): AlertsBundle {
  const scenario = key === "custom" ? state.custom : state.scenarios[key];
  const delayed = findDelayedReceipts(scenario, state.baseline);
  const alerts = classifyRisk({
    scenarioName: scenario.name,
    engine: scenario.engine,
    ledger: scenario.ledger,
    baseline: state.baseline,
    delayedReceiptIds: delayed.map((d) => d.eventId),
    supplierAgreementConfirmed: state.supplierAgreementConfirmed,
  });
  return { alerts, delayed };
}

export function computeRecommendations(state: AppState, key: ScenarioKey): Recommendation[] {
  const scenario = key === "custom" ? state.custom : state.scenarios[key];
  const { alerts } = computeAlerts(state, key);
  return recommendAction({ scenario, baseline: state.baseline, alerts, supplierAgreementConfirmed: state.supplierAgreementConfirmed });
}

/** Full initial state: mandatory demo, fully computed. */
export function buildInitialState(): AppState {
  const baseline = buildDemoBaseline();
  const { baseline: bState, downside, intervention } = buildMandatoryScenarios();
  return {
    baseline,
    scenarios: { baseline: bState, downside, intervention },
    customOps: [],
    custom: computeCustom(baseline, []),
    selectedScenario: "downside",
    supplierAgreementConfirmed: false,
    lastUpdated: new Date().toISOString(),
  };
}

/** Apply a user what-if op to the custom scenario. */
export function applyCustomOp(state: AppState, op: ScenarioOp): AppState {
  const customOps = [...state.customOps, op];
  return {
    ...state,
    customOps,
    custom: computeCustom(state.baseline, customOps),
    selectedScenario: "custom",
    lastUpdated: new Date().toISOString(),
  };
}

export function resetCustom(state: AppState): AppState {
  return {
    ...state,
    customOps: [],
    custom: computeCustom(state.baseline, []),
    selectedScenario: "baseline",
    lastUpdated: new Date().toISOString(),
  };
}

export function resetDemo(): AppState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — fine */
  }
  return buildInitialState();
}

/** Mutable ledger edit inside a scenario (used by Cash Ledger UI). */
export function editEventInScenario(state: AppState, key: ScenarioKey, eventId: string, patch: Partial<LedgerEvent>): AppState {
  const scenario = key === "custom" ? state.custom : state.scenarios[key];
  const newLedger = scenario.ledger.map((e) => (e.id === eventId ? { ...e, ...patch } : e));
  const newScenario: ScenarioState = {
    ...scenario,
    ledger: newLedger,
    engine: runScenarioOnLedger(state.baseline, newLedger, scenario.minimumReserveSen),
  };
  if (key === "custom") {
    return { ...state, custom: newScenario, lastUpdated: new Date().toISOString() };
  }
  return { ...state, scenarios: { ...state.scenarios, [key]: newScenario }, lastUpdated: new Date().toISOString() };
}

export function addEventToScenario(state: AppState, key: ScenarioKey, ev: LedgerEvent): AppState {
  const scenario = key === "custom" ? state.custom : state.scenarios[key];
  const newLedger = [...scenario.ledger, ev];
  const newScenario: ScenarioState = {
    ...scenario,
    ledger: newLedger,
    engine: runScenarioOnLedger(state.baseline, newLedger, scenario.minimumReserveSen),
  };
  if (key === "custom") {
    return { ...state, custom: newScenario, lastUpdated: new Date().toISOString() };
  }
  return { ...state, scenarios: { ...state.scenarios, [key]: newScenario }, lastUpdated: new Date().toISOString() };
}

export function deleteEventFromScenario(state: AppState, key: ScenarioKey, eventId: string): AppState {
  const scenario = key === "custom" ? state.custom : state.scenarios[key];
  const newLedger = scenario.ledger.filter((e) => e.id !== eventId);
  const newScenario: ScenarioState = {
    ...scenario,
    ledger: newLedger,
    engine: runScenarioOnLedger(state.baseline, newLedger, scenario.minimumReserveSen),
  };
  if (key === "custom") {
    return { ...state, custom: newScenario, lastUpdated: new Date().toISOString() } as AppState;
  }
  return { ...state, scenarios: { ...state.scenarios, [key]: newScenario }, lastUpdated: new Date().toISOString() };
}

function runScenarioOnLedger(baseline: BaselineDefinition, ledger: LedgerEvent[], reserve: number): ScenarioState["engine"] {
  // Direct engine run on an already-materialized ledger.
  return runEngine({
    openingCashSen: baseline.openingCashSen,
    minimumReserveSen: reserve,
    horizonDays: baseline.horizonDays,
    events: ledger,
    anchorDate: baseline.anchorDate,
  });
}

/** Validation + repair of persisted state (never trust storage). */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildInitialState();
    const parsed = JSON.parse(raw) as AppState;
    // Structural checks: recompute everything from the durable baseline.
    if (
      parsed &&
      parsed.baseline &&
      Array.isArray(parsed.baseline.ledger) &&
      parsed.baseline.ledger.length >= 3 &&
      typeof parsed.baseline.openingCashSen === "number"
    ) {
      const baseline = parsed.baseline;
      const { baseline: bState, downside, intervention } = buildMandatoryScenarios();
      const customOps = Array.isArray(parsed.customOps) ? parsed.customOps : [];
      return {
        baseline,
        scenarios: { baseline: bState, downside, intervention },
        customOps,
        custom: computeCustom(baseline, customOps),
        selectedScenario: ["baseline", "downside", "intervention", "custom"].includes(parsed.selectedScenario) ? parsed.selectedScenario : "downside",
        supplierAgreementConfirmed: !!parsed.supplierAgreementConfirmed,
        lastUpdated: new Date().toISOString(),
      };
    }
    return buildInitialState();
  } catch {
    return buildInitialState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — app still works in-memory */
  }
}

export interface EvaluationPanel {
  detection: { tp: number; fp: number; fn: number; tn: number };
  recall: number | null;
  fpr: number | null;
  leadTimes: Array<{ caseId: string; leadDays: number }>;
  forecastMaeSen: number | null;
  forecastRmseSen: number | null;
  intervention: ReturnType<typeof interventionEffectiveness>;
  synthetic: ReturnType<typeof runSyntheticCases>;
  syntheticPassed: number;
  syntheticTotal: number;
  suite: ReturnType<typeof runFullSuite>;
}

/** Compute the full evaluation panel from real runs (no hardcoded results). */
export function computeEvaluationPanel(): EvaluationPanel {
  const evalCases: EvalCase[] = buildSyntheticCases();
  const detection = evaluateDetection(evalCases, (engine) => engine.breachEpisodes.length > 0);
  const { predictions, actuals } = generateForecastPairs();
  const { baseline, downside, intervention } = buildMandatoryScenarios();
  return {
    detection,
    recall: recall(detection),
    fpr: falsePositiveRate(detection),
    leadTimes: leadTimeDistribution(evalCases),
    forecastMaeSen: forecastMAE(predictions, actuals),
    forecastRmseSen: forecastRMSE(predictions, actuals),
    intervention: interventionEffectiveness(downside.engine, intervention.engine),
    synthetic: runSyntheticCases(),
    syntheticPassed: runSyntheticCases().filter((r) => r.pass).length,
    syntheticTotal: runSyntheticCases().length,
    suite: runFullSuite(),
  };
}
