import type { DataClass, SourceLabel, LedgerEvent, AlertSeverity, Decision } from "../engine/types";

export function Badge({ kind, children }: { kind: DataClass | SourceLabel | AlertSeverity | Decision | "pass" | "fail" | "event"; children: React.ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function dataClassLabel(dc: DataClass): string {
  switch (dc) {
    case "known": return "Confirmed";
    case "user_assumption": return "User assumption";
    case "heuristic": return "Heuristic forecast";
    case "scenario": return "Scenario value";
    case "unknown": return "Unknown";
  }
}

export function sourceLabel(s: SourceLabel): string {
  switch (s) {
    case "user_entered": return "User-entered";
    case "synthetic_demo": return "Synthetic demo data";
    case "imported_history": return "Imported history";
    case "rule_based_estimate": return "Rule-based estimate";
    case "historical_median_forecast": return "Historical median forecast";
    case "scenario_assumption": return "Scenario assumption";
  }
}

export function Card({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title && <header className="card-head"><h3>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</header>}
      {children}
    </section>
  );
}

export function Stat({ label, value, asOf, tone, hint }: { label: string; value: string; asOf?: string; tone?: "ok" | "warn" | "bad" | "neutral"; hint?: string }) {
  return (
    <div className={`stat stat-${tone ?? "neutral"}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {asOf && <div className="stat-asof muted">as of {asOf}</div>}
      {hint && <div className="stat-hint muted">{hint}</div>}
    </div>
  );
}

export function EventTypeTag({ t }: { t: LedgerEvent["eventType"] }) {
  const map: Record<LedgerEvent["eventType"], string> = {
    receipt: "Receipt",
    payroll: "Payroll",
    supplier_payment: "Supplier",
    operating_expense: "OpEx",
    tax: "Tax",
    loan_payment: "Loan",
    other: "Other",
  };
  return <span className={`etype etype-${t}`}>{map[t]}</span>;
}
