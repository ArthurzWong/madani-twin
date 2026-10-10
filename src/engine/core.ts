/**
 * MADANI Twin — Core Financial Engine (pure, deterministic)
 * ---------------------------------------------------------
 * ClosingCash(day) = OpeningCash + sum(all signed events with expectedDate <= day)
 * Breach: closing cash STRICTLY LESS than minimum reserve.
 * Balances are closing-of-day values after all same-day events are applied.
 */
import type {
  LedgerEvent,
  EngineResult,
  DailyBalance,
  BreachEpisode,
  ValidationIssue,
} from "./types";
import { validateLedger, sortEventsDeterministically, isoForDay, isValidISODate } from "./money";

export interface EngineInput {
  openingCashSen: number;
  minimumReserveSen: number;
  horizonDays: number;
  events: LedgerEvent[];
  /** Anchor date (ISO) for Day 0. */
  anchorDate: string;
  /** Exclude cancelled events from arithmetic (default true). */
  includeCancelled?: boolean;
}

/** Calculate daily closing balances for the horizon. */
export function calculateDailyBalances(
  openingCashSen: number,
  events: LedgerEvent[],
  horizonDays: number,
  anchorDate: string
): DailyBalance[] {
  const sorted = sortEventsDeterministically(events.filter((e) => e.status !== "cancelled"));
  const byDay = new Map<number, LedgerEvent[]>();
  for (const e of sorted) {
    if (!Number.isInteger(e.amountSen) || !Number.isFinite(e.amountSen)) continue; // invalid amounts excluded from math, reported by validateLedger
    if (!isValidISODate(e.expectedDate)) continue; // invalid-dated events excluded from math, reported by validateLedger
    const ms = Date.parse(e.expectedDate + "T00:00:00Z");
    const anchor = Date.parse(anchorDate + "T00:00:00Z");
    const day = Math.round((ms - anchor) / 86400000);
    if (day < 0 || day > horizonDays) continue; // outside horizon
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }
  const daily: DailyBalance[] = [];
  let cash = openingCashSen;
  for (let d = 0; d <= horizonDays; d++) {
    const evs = byDay.get(d) ?? [];
    let net = 0;
    const applied: string[] = [];
    for (const e of evs) {
      net += e.amountSen;
      applied.push(e.id);
    }
    cash += net;
    daily.push({
      day: d,
      date: isoForDay(anchorDate, d),
      closingSen: cash,
      dayNetSen: net,
      appliedEventIds: applied,
      isBreach: false,
    });
  }
  return daily;
}

/** Mark breach days (closing < reserve strictly) and return episodes. */
export function findReserveBreaches(
  daily: DailyBalance[],
  minimumReserveSen: number
): BreachEpisode[] {
  let inEpisode = false;
  let start = 0;
  const episodes: BreachEpisode[] = [];
  for (let i = 0; i < daily.length; i++) {
    const b = daily[i];
    b.isBreach = b.closingSen < minimumReserveSen;
    if (b.isBreach && !inEpisode) {
      inEpisode = true;
      start = i;
    } else if (!b.isBreach && inEpisode) {
      inEpisode = false;
      episodes.push(makeEpisode(daily, start, i - 1));
    }
  }
  if (inEpisode) episodes.push(makeEpisode(daily, start, daily.length - 1));
  return episodes;
}

function makeEpisode(daily: DailyBalance[], start: number, end: number): BreachEpisode {
  let minBalanceSen = Infinity;
  let minDay = start;
  for (let d = start; d <= end; d++) {
    if (daily[d].closingSen < minBalanceSen) {
      minBalanceSen = daily[d].closingSen;
      minDay = d;
    }
  }
  return {
    startDay: start,
    endDay: end,
    minBalanceSen,
    minDay,
    maxShortfallSen: daily.length > 0 ? Math.max(0, /* caller injects reserve via engine */ 0) : 0,
    responsibleEventIds: daily[minDay].appliedEventIds.filter((id) => id !== "__opening__"),
  };
}

/** Minimum closing balance across the horizon. */
export function calculateMinimumBalance(daily: DailyBalance[]): { minSen: number; day: number } {
  let minSen = Infinity;
  let day = 0;
  for (const b of daily) {
    if (b.closingSen < minSen) {
      minSen = b.closingSen;
      day = b.day;
    }
  }
  return { minSen: minSen === Infinity ? 0 : minSen, day };
}

export function calculateShortfall(balanceSen: number, minimumReserveSen: number): number {
  return Math.max(0, minimumReserveSen - balanceSen);
}

/** Lead time = breachDay - detectionDay (calendar days). */
export function calculateLeadTime(detectionDay: number, breachDay: number): number {
  return breachDay - detectionDay;
}

/**
 * Run the full engine. Pure: does not mutate input events.
 */
export function runEngine(input: EngineInput): EngineResult {
  const { openingCashSen, minimumReserveSen, horizonDays, anchorDate } = input;
  const events = input.events;
  const validationIssues: ValidationIssue[] = validateLedger(events);
  const daily = calculateDailyBalances(openingCashSen, events, horizonDays, anchorDate);
  const episodes = findReserveBreaches(daily, minimumReserveSen);
  // Inject real shortfall into episodes (needs reserve here).
  for (const ep of episodes) {
    ep.maxShortfallSen = Math.max(0, minimumReserveSen - ep.minBalanceSen);
  }
  const { minSen, day } = calculateMinimumBalance(daily);
  const firstBreachDay = episodes.length > 0 ? episodes[0].startDay : null;
  let totalShortfallSen = 0;
  for (const b of daily) {
    if (b.isBreach) totalShortfallSen += minimumReserveSen - b.closingSen;
  }
  return {
    openingCashSen,
    minimumReserveSen,
    horizonDays,
    daily,
    minBalanceSen: minSen,
    minDay: day,
    breachEpisodes: episodes,
    firstBreachDay,
    totalShortfallSen,
    validationIssues,
  };
}
