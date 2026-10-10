/**
 * MADANI Twin — Money & Date Utilities
 * ------------------------------------
 * Integer-sen arithmetic (decimal-safe). Dates are ISO YYYY-MM-DD strings;
 * day arithmetic uses UTC to stay deterministic.
 */
import type { LedgerEvent, ValidationIssue } from "./types";

export const SEN_PER_RM = 100;

/** Format integer sen as an MYR string, e.g. -500000 -> "-RM5,000.00" */
export function formatMYR(sen: number, opts?: { compact?: boolean }): string {
  const sign = sen < 0 ? "-" : "";
  const abs = Math.abs(Math.round(sen));
  const rm = Math.floor(abs / SEN_PER_RM);
  const rem = abs % SEN_PER_RM;
  if (opts?.compact && rem === 0) {
    return `${sign}RM${rm.toLocaleString("en-MY")}`;
  }
  const frac = rem.toString().padStart(2, "0");
  return `${sign}RM${rm.toLocaleString("en-MY")}.${frac}`;
}

/** Parse "RM1,234.50" / "1234.5" / "-500" (sen if integer without decimals? no: RM by default) to sen. */
export function parseMYRToSen(input: string): number | null {
  if (input == null) return null;
  const cleaned = input.replace(/,/g, "").replace(/^\s*RM\s*/i, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  // Reject anything that is not a plain decimal number.
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const neg = cleaned.startsWith("-");
  const [intPartRaw, fracPartRaw = ""] = cleaned.replace("-", "").split(".");
  const intPart = intPartRaw.slice(0, 12); // guard absurd lengths
  const fracPart = (fracPartRaw + "00").slice(0, 2);
  const sen = parseInt(intPart, 10) * SEN_PER_RM + parseInt(fracPart, 10);
  if (!Number.isFinite(sen)) return null;
  return neg ? -sen : sen;
}

/** ISO date for a day index relative to anchor (UTC-safe). */
export function isoForDay(anchor: string, day: number): string {
  const d = new Date(anchor + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

/** Parse ISO date -> UTC ms. Returns NaN for invalid dates. */
export function isoToUTCms(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return NaN;
  const ms = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(ms)) return NaN;
  // Round-trip check catches e.g. 2026-02-31.
  const rt = new Date(ms).toISOString().slice(0, 10);
  return rt === iso ? ms : NaN;
}

export function isValidISODate(iso: string): boolean {
  return !Number.isNaN(isoToUTCms(iso));
}

/** Days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = isoToUTCms(b) - isoToUTCms(a);
  return Math.round(ms / 86400000);
}

export function todayISO(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

/**
 * Validate the ledger. Never drops events: errors are reported and the UI
 * surfaces them; the engine excludes only structurally unusable events
 * (NaN amounts / invalid dates) from balance arithmetic and says so.
 */
export function validateLedger(events: LedgerEvent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  for (const e of events) {
    if (!e.id) {
      issues.push({ eventId: e.id || "(missing)", field: "id", severity: "error", message: "Event is missing an ID." });
    } else if (seenIds.has(e.id)) {
      issues.push({ eventId: e.id, field: "id", severity: "error", message: `Duplicate event ID ${e.id}.` });
    }
    seenIds.add(e.id);
    if (!Number.isInteger(e.amountSen)) {
      issues.push({ eventId: e.id, field: "amount", severity: "error", message: `${e.description || e.id}: amount is not an integer sen value.` });
    } else if (e.amountSen === 0) {
      issues.push({ eventId: e.id, field: "amount", severity: "warning", message: `${e.description || e.id}: zero amount (is this intentional? zero differs from missing).` });
    }
    if (!isValidISODate(e.dueDate)) {
      issues.push({ eventId: e.id, field: "dueDate", severity: "error", message: `${e.description || e.id}: invalid due date "${e.dueDate}".` });
    }
    if (!isValidISODate(e.expectedDate)) {
      issues.push({ eventId: e.id, field: "expectedDate", severity: "error", message: `${e.description || e.id}: invalid expected date "${e.expectedDate}".` });
    }
    if (!e.description || e.description.trim() === "") {
      issues.push({ eventId: e.id, field: "description", severity: "warning", message: `${e.id}: missing description.` });
    }
    if (e.eventType === "receipt" && e.amountSen < 0) {
      issues.push({ eventId: e.id, field: "amount", severity: "warning", message: `${e.description}: receipt with negative amount — treat as outflow?` });
    }
  }
  return issues;
}

/**
 * Deterministic ordering: by expected date, then receipt-before-payment
 * within a day, then amount magnitude (larger absolute first), then id —
 * a total order so results are reproducible.
 */
export function sortEventsDeterministically(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => {
    const da = isoToUTCms(a.expectedDate);
    const db = isoToUTCms(b.expectedDate);
    if (da !== db) return da - db;
    const dirA = a.amountSen >= 0 ? 0 : 1;
    const dirB = b.amountSen >= 0 ? 0 : 1;
    if (dirA !== dirB) return dirA - dirB; // inflows first
    const magA = Math.abs(a.amountSen);
    const magB = Math.abs(b.amountSen);
    if (magA !== magB) return magB - magA; // larger absolute amount first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
