/**
 * MADANI Twin — Bill Forecasting Engine
 * -------------------------------------
 * Reproducible robust forecasting of recurring bills from historical
 * observations grouped by vendor + category. No invented training data:
 * the caller supplies history; the engine reports its evidence level.
 *
 * Method:
 * 1. If n >= 4 comparable observations: robust median of recent comparable bills.
 * 2. Dispersion: Median Absolute Deviation (MAD).
 * 3. Outliers: observations with |x - median| > 3 * (1.4826 * MAD) are FLAGGED
 *    (kept, never deleted) and excluded from the median when n >= 6.
 * 4. Baseline comparison: last observed amount.
 * 5. Held-out evaluation: when n >= 6, the latest observation is held out;
 *    MAE(median-of-earlier) vs MAE(last-observed) reported.
 * 6. n < 4 => point estimate = median of what exists, method
 *    "insufficient_history", evidence "low", explicit uncertainty warning.
 */
import type { BillObservation, ForecastResult } from "./types";

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median Absolute Deviation (raw, in sen). */
export function mad(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const med = median(xs);
  return median(xs.map((x) => Math.abs(x - med)));
}

/** Median of the k most recent observations by date (ties by id for determinism). */
function recentValues(obs: BillObservation[]): number[] {
  return obs.map((o) => o.amountSen);
}

export function sortObservations(obs: BillObservation[]): BillObservation[] {
  return [...obs].sort((a, b) => {
    const d = Date.parse(a.date + "T00:00:00Z") - Date.parse(b.date + "T00:00:00Z");
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalized quantile factor for ~3-sigma under normal approx. */
const MAD_SIGMA = 1.4826;

export function forecastRecurringBill(
  history: BillObservation[],
  vendor: string,
  category: string
): ForecastResult {
  const comparable = sortObservations(
    history.filter((o) => o.vendor === vendor && o.category === category && Number.isInteger(o.amountSen))
  );
  const n = comparable.length;
  const base = {
    vendor,
    category,
    sampleSize: n,
    lastObservedSen: n > 0 ? comparable[n - 1].amountSen : null,
  };

  if (n === 0) {
    return {
      ...base,
      pointEstimateSen: null,
      method: "insufficient_history",
      evidence: "low",
      outlierIds: [],
      uncertaintyWarning: "No historical observations for this vendor/category. Estimate unavailable — enter the expected amount manually.",
    };
  }

  if (n < 4) {
    const est = median(recentValues(comparable));
    return {
      ...base,
      pointEstimateSen: Math.round(est),
      method: "insufficient_history",
      evidence: "low",
      outlierIds: [],
      uncertaintyWarning: `Only ${n} observation(s) — this is a low-evidence estimate, not a reliable model prediction.`,
    };
  }

  const values = recentValues(comparable);
  const med = median(values);
  const dispersion = mad(values);
  const flagged =
    dispersion === 0 && values.every((v) => v === med)
      ? []
      : comparable
          .filter((o) => Math.abs(o.amountSen - med) > 3 * MAD_SIGMA * dispersion)
          .map((o) => o.id);

  // With >= 6 observations, exclude flagged outliers from the median (kept visible, not deleted).
  let core = comparable;
  let method: ForecastResult["method"] = "robust_median";
  if (n >= 6 && flagged.length > 0 && flagged.length < n / 2) {
    core = comparable.filter((o) => !flagged.includes(o.id));
    method = "robust_median_trimmed";
  }
  const coreValues = core.map((o) => o.amountSen);
  const pointEstimateSen = Math.round(median(coreValues));

  const result: ForecastResult = {
    ...base,
    pointEstimateSen,
    method,
    evidence: n >= 8 ? "high" : "medium",
    outlierIds: flagged,
    madSen: Math.round(dispersion),
  };

  // Uncertainty interval from MAD when enough data (n >= 6):
  if (n >= 6) {
    const spread = 3 * MAD_SIGMA * dispersion;
    if (spread > 0) {
      result.intervalSen = {
        lowSen: Math.max(0, Math.round(pointEstimateSen - spread)),
        highSen: Math.round(pointEstimateSen + spread),
      };
    }
  } else {
    result.uncertaintyWarning = `Based on ${n} observations — point estimate shown without a calibrated interval.`;
  }

  // Held-out evaluation when n >= 6: predict the LAST observation from the earlier ones.
  if (n >= 6) {
    const train = comparable.slice(0, n - 1);
    const actualSen = comparable[n - 1].amountSen;
    const trainValues = train.map((o) => o.amountSen);
    const medianPred = median(trainValues);
    const lastPred = trainValues[trainValues.length - 1];
    const medErr = Math.abs(medianPred - actualSen);
    const lastErr = Math.abs(lastPred - actualSen);
    result.heldOutMaeSen = Math.round(medErr);
    result.baselineMaeSen = Math.round(lastErr);
  }

  return result;
}

/** Detect outlier observations against the median (documented 3-sigma robust rule). */
export function detectOutliers(obs: BillObservation[]): string[] {
  const values = obs.map((o) => o.amountSen);
  if (values.length < 4) return [];
  const med = median(values);
  const dispersion = mad(values);
  if (dispersion === 0) return [];
  return obs
    .filter((o) => Math.abs(o.amountSen - med) > 3 * MAD_SIGMA * dispersion)
    .map((o) => o.id);
}

/** MAE over paired predictions/actuals (sen). Empty arrays return null (honest denominator). */
export function forecastMAE(predictions: number[], actuals: number[]): number | null {
  if (predictions.length === 0 || actuals.length === 0) return null;
  if (predictions.length !== actuals.length) return null;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) sum += Math.abs(predictions[i] - actuals[i]);
  return sum / predictions.length;
}

/** RMSE over paired predictions/actuals (sen). */
export function forecastRMSE(predictions: number[], actuals: number[]): number | null {
  if (predictions.length === 0 || actuals.length === 0) return null;
  if (predictions.length !== actuals.length) return null;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const e = predictions[i] - actuals[i];
    sum += e * e;
  }
  return Math.sqrt(sum / predictions.length);
}
