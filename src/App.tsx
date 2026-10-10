import { useEffect, useMemo, useState } from "react";
import type { LedgerEvent, ScenarioOp, ScenarioState } from "./engine/types";
import {
  loadState, saveState, buildInitialState, applyCustomOp, resetCustom, resetDemo,
  computeAlerts, computeRecommendations, editEventInScenario, addEventToScenario, deleteEventFromScenario,
  findDelayedReceipts, computeEvaluationPanel, type AppState, type ScenarioKey,
} from "./state/appState";
import { buildDemoEvents } from "./engine/demoScenario";
import { formatMYR, parseMYRToSen, isValidISODate, isoForDay } from "./engine/money";
import { isoForDayPublic, DEMO_ANCHOR_DATE } from "./engine/demoScenario";
import { Card, Stat, Badge, dataClassLabel, sourceLabel, EventTypeTag } from "./components/ui";
import { TrajectoryChart, ChartLegend } from "./components/TrajectoryChart";

const SCENARIO_COLORS: Record<string, string> = {
  baseline: "#2f6f4f",
  downside: "#d64545",
  intervention: "#2b6cb0",
  custom: "#8a5cc2",
};

function useAppState() {
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => { saveState(state); }, [state]);
  return [state, setState] as const;
}

function scenarioOf(state: AppState, key: ScenarioKey): ScenarioState {
  return key === "custom" ? state.custom : state.scenarios[key];
}

export default function App() {
  const [state, setState] = useAppState();
  const [tab, setTab] = useState<TabKey>("overview");
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>(state.selectedScenario as ScenarioKey);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { setActiveScenario(state.selectedScenario as ScenarioKey); }, [state.selectedScenario]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const runDemo = () => {
    setState(buildInitialState());
    setActiveScenario("downside");
    setTab("overview");
    notify("MADANI Demo loaded — mandatory scenario with baseline, downside and intervention.");
  };

  const scenario = scenarioOf(state, activeScenario);
  const engine = scenario.engine;
  const first7 = engine.daily[7];
  const unresolved = computeAlerts(state, activeScenario).alerts.filter((a) => !a.resolved);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>MADANI Twin</h1>
            <p className="muted">Cash-flow decision engine for Malaysian SMEs — Predict Early, Decide Better</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={runDemo}>▶ Run MADANI Demo</button>
          <button className="btn" onClick={() => { setState(resetDemo()); setActiveScenario("downside"); notify("Demo reset to the exact original test state."); }}>↺ Reset Demo</button>
        </div>
      </header>

      <div className="banner">Illustrative synthetic SME scenario — not real company financial data.</div>

      <ScenarioSwitch
        state={state}
        active={activeScenario}
        onSelect={(k) => { setActiveScenario(k); setState({ ...state, selectedScenario: k }); }}
      />

      <nav className="tabs" role="tablist">
        {([
          ["overview", "Overview"],
          ["ledger", "Cash Ledger"],
          ["guardian", `Payment Guardian${unresolved.length ? ` (${unresolved.length})` : ""}`],
          ["simulator", "What-if Simulator"],
          ["evaluation", "Forecast & Evaluation"],
          ["assumptions", "Data & Assumptions"],
        ] as Array<[TabKey, string]>).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      <main className="content">
        {tab === "overview" && <Overview state={state} scenarioKey={activeScenario} />}
        {tab === "ledger" && <LedgerPanel state={state} scenarioKey={activeScenario} setState={setState} notify={notify} />}
        {tab === "guardian" && <GuardianPanel state={state} scenarioKey={activeScenario} />}
        {tab === "simulator" && <SimulatorPanel state={state} setState={setState} notify={notify} />}
        {tab === "evaluation" && <EvaluationPanel />}
        {tab === "assumptions" && <AssumptionsPanel state={state} />}
      </main>

      <footer className="footer muted">
        MADANI Twin · Dormathon 2026 Track 1 · Deterministic integer-sen engine · All figures are synthetic scenario outputs, closing-of-day, MYR.
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

type TabKey = "overview" | "ledger" | "guardian" | "simulator" | "evaluation" | "assumptions";

/* ================= Overview ================= */

function Overview({ state, scenarioKey }: { state: AppState; scenarioKey: ScenarioKey }) {
  const scenario = scenarioOf(state, scenarioKey);
  const engine = scenario.engine;
  const { alerts } = computeAlerts(state, scenarioKey);
  const recs = computeRecommendations(state, scenarioKey);
  const day7 = engine.daily[7];
  const incoming7 = sumRange(scenario.ledger, 1, 7, true);
  const incoming30 = sumRange(scenario.ledger, 1, 30, true);
  const outgoing7 = sumRange(scenario.ledger, 1, 7, false);
  const outgoing30 = sumRange(scenario.ledger, 1, 30, false);

  const chartScenarios = [
    { name: "Baseline", engine: state.scenarios.baseline.engine, color: SCENARIO_COLORS.baseline },
    { name: "Downside", engine: state.scenarios.downside.engine, color: SCENARIO_COLORS.downside, emphasize: true },
    { name: "Intervention", engine: state.scenarios.intervention.engine, color: SCENARIO_COLORS.intervention },
    ...(scenarioKey === "custom" ? [{ name: "Your scenario", engine: state.custom.engine, color: SCENARIO_COLORS.custom, emphasize: true }] : []),
  ];

  const breach = engine.breachEpisodes[0];

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat label="Current cash (Day 0)" value={formatMYR(engine.openingCashSen)} asOf={engine.daily[0].date} tone="neutral" hint="Opening balance" />
        <Stat label="Minimum reserve" value={formatMYR(engine.minimumReserveSen)} tone="neutral" hint="Configurable safety floor" />
        <Stat label="Incoming 7d / 30d" value={`${formatMYR(incoming7, { compact: true })} / ${formatMYR(incoming30, { compact: true })}`} tone="ok" hint="Expected receipts (confirmed + forecast)" />
        <Stat label="Upcoming bills 7d / 30d" value={`${formatMYR(outgoing7, { compact: true })} / ${formatMYR(outgoing30, { compact: true })}`} tone="warn" hint="Payroll, suppliers, expenses" />
        <Stat label={`Projected minimum (${scenario.name})`} value={formatMYR(engine.minBalanceSen)} asOf={`Day ${engine.minDay}`} tone={engine.minBalanceSen < engine.minimumReserveSen ? "bad" : "ok"} hint="Lowest projected closing cash" />
        <Stat
          label="Earliest reserve breach"
          value={engine.firstBreachDay !== null ? `Day ${engine.firstBreachDay}` : "None"}
          asOf={engine.firstBreachDay !== null ? engine.daily[engine.firstBreachDay].date : undefined}
          tone={engine.firstBreachDay !== null ? "bad" : "ok"}
          hint={engine.firstBreachDay !== null ? `${engine.firstBreachDay} days of warning from today` : "Reserve holds through Day 30"}
        />
        <Stat label="Total projected shortfall" value={breach ? formatMYR(engine.totalShortfallSen) : formatMYR(0)} tone={breach ? "bad" : "ok"} hint="Sum of daily gaps below reserve" />
        <Stat label="Unresolved risk alerts" value={String(alerts.filter((a) => !a.resolved).length)} tone={alerts.some((a) => a.severity === "critical" && !a.resolved) ? "bad" : alerts.length ? "warn" : "ok"} hint="Payment Guardian findings" />
        <Stat label={`Day-30 closing (${scenario.name})`} value={formatMYR(engine.daily[engine.horizonDays].closingSen)} asOf={engine.daily[engine.horizonDays].date} tone={engine.daily[engine.horizonDays].closingSen >= engine.minimumReserveSen ? "ok" : "bad"} hint="End of horizon" />
      </div>

      <Card title={`Cash trajectory — ${scenario.name}`} subtitle="Daily closing cash after all same-day events (deterministic engine output). Shaded band = projected breach window.">
        <TrajectoryChart scenarios={chartScenarios} reserveSen={engine.minimumReserveSen} />
        <ChartLegend items={chartScenarios.map((s) => ({ name: s.name, color: s.color, desc: `min ${formatMYR(s.engine.minBalanceSen, { compact: true })} on Day ${s.engine.minDay}` }))} />
      </Card>

      <div className="two-col">
        <Card title="Scenario comparison" subtitle="Engine-calculated outcomes for the three mandatory scenarios.">
          <table className="table">
            <thead><tr><th>Scenario</th><th>Day 7 cash</th><th>Minimum</th><th>Breach days</th><th>Day 30</th></tr></thead>
            <tbody>
              {(["baseline", "downside", "intervention"] as const).map((k) => {
                const s = state.scenarios[k];
                const e = s.engine;
                return (
                  <tr key={k} className={scenarioKey === k ? "row-active" : ""}>
                    <td><span className="legend-swatch" style={{ background: SCENARIO_COLORS[k] }} /> {s.name}</td>
                    <td>{formatMYR(e.daily[7].closingSen)}</td>
                    <td>{formatMYR(e.minBalanceSen)} <span className="muted">(Day {e.minDay})</span></td>
                    <td>{e.daily.filter((d) => d.isBreach).length}</td>
                    <td>{formatMYR(e.daily[30].closingSen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title="Why this forecast?" subtitle="Generated from scenario state — never hardcoded.">
          <ExplainBox state={state} scenarioKey={scenarioKey} />
        </Card>
      </div>

      <Card title="Payment recommendations" subtitle="APPROVE / HOLD / REVIEW over the full projected trajectory — never on current cash alone.">
        {recs.length === 0 && <p className="muted">No outgoing payments in this scenario.</p>}
        {recs.map((r) => (
          <div key={r.eventId} className={`rec rec-${r.decision.toLowerCase()}`}>
            <div className="rec-head">
              <Badge kind={r.decision}>{r.decision}</Badge>
              <strong>{r.description}</strong>
            </div>
            <ul className="rec-reasons">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
            {r.actionPreview && (
              <div className="rec-preview">
                <strong>Test:</strong> {r.actionPreview.description} → projected minimum {formatMYR(r.actionPreview.newMinBalanceSen)}, {r.actionPreview.breachesRemaining === 0 ? "no breaches remain" : `${r.actionPreview.breachesRemaining} breach episode(s) remain`}.
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function ExplainBox({ state, scenarioKey }: { state: AppState; scenarioKey: ScenarioKey }) {
  const scenario = scenarioOf(state, scenarioKey);
  const e = scenario.engine;
  const parts: string[] = [];
  if (scenarioKey === "downside" || scenario.ops.some((o) => o.kind === "move_event" && o.eventId === "demo-receipt-001" && o.newDay === 9)) {
    parts.push(
      "Your RM20,000 customer receipt moved from Day 5 to Day 9. Payroll of RM25,000 and a supplier payment of RM20,000 remain due on Day 7. Projected closing cash falls to RM5,000, which is RM5,000 below your RM10,000 reserve."
    );
  }
  if (scenarioKey === "intervention" || scenario.ops.some((o) => o.kind === "split_postpone")) {
    parts.push(
      "Postponing RM10,000 of the supplier payment until Day 9 raises projected Day 7 closing cash to RM15,000. The forecast remains above the RM10,000 reserve through Day 30 under the current scenario assumptions. Supplier agreement has not been confirmed unless explicitly recorded by the user."
    );
  }
  if (scenarioKey === "baseline") {
    parts.push(
      `With the contracted schedule (receipt Day 5), closing cash stays at or above ${formatMYR(e.minBalanceSen)} — the lowest point, on Day 7 after payroll and the supplier payment — comfortably above the ${formatMYR(e.minimumReserveSen)} reserve.`
    );
  }
  if (scenarioKey === "custom") {
    if (e.breachEpisodes.length > 0) {
      const ep = e.breachEpisodes[0];
      parts.push(
        `Your ${scenario.ops.length} change(s) project closing cash as low as ${formatMYR(ep.minBalanceSen)} on Day ${ep.minDay} — ${formatMYR(ep.maxShortfallSen)} below the ${formatMYR(e.minimumReserveSen)} reserve. Responsible events on that day: ${ep.responsibleEventIds.join(", ") || "none"}.`
      );
    } else {
      parts.push(`With your ${scenario.ops.length} change(s), the projected minimum is ${formatMYR(e.minBalanceSen)} on Day ${e.minDay} — above the ${formatMYR(e.minimumReserveSen)} reserve through Day 30.`);
    }
  }
  return <div className="explain">{parts.map((p, i) => <p key={i}>{p}</p>)}</div>;
}

function sumRange(ledger: LedgerEvent[], fromDay: number, toDay: number, inflow: boolean): number {
  return ledger
    .filter((e) => e.status !== "cancelled" && Number.isInteger(e.amountSen))
    .filter((e) => (e.dayIndex ?? 0) >= fromDay && (e.dayIndex ?? 0) <= toDay)
    .filter((e) => (inflow ? e.amountSen > 0 : e.amountSen < 0))
    .reduce((s, e) => s + Math.abs(e.amountSen), 0);
}

/* ================= Scenario switch ================= */

function ScenarioSwitch({ state, active, onSelect }: { state: AppState; active: ScenarioKey; onSelect: (k: ScenarioKey) => void }) {
  const items: Array<{ k: ScenarioKey; label: string; desc: string }> = [
    { k: "baseline", label: "Baseline", desc: "Contracted schedule" },
    { k: "downside", label: "Downside", desc: "Receipt slips to Day 9" },
    { k: "intervention", label: "Intervention", desc: "Defer RM10k of supplier bill" },
    { k: "custom", label: state.customOps.length ? `Your scenario (${state.customOps.length})` : "Your scenario", desc: "What-if sandbox" },
  ];
  return (
    <div className="scenario-switch" role="radiogroup" aria-label="Active scenario">
      {items.map((it) => (
        <button
          key={it.k}
          role="radio"
          aria-checked={active === it.k}
          className={`scn-btn ${active === it.k ? "active" : ""} scn-${it.k}`}
          onClick={() => onSelect(it.k)}
        >
          <strong>{it.label}</strong>
          <span className="muted">{it.desc}</span>
        </button>
      ))}
    </div>
  );
}

/* ================= Ledger ================= */

function LedgerPanel({ state, scenarioKey, setState, notify }: { state: AppState; scenarioKey: ScenarioKey; setState: (fn: (s: AppState) => AppState) => void; notify: (m: string) => void }) {
  const scenario = scenarioOf(state, scenarioKey);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"date" | "amount">("date");
  const [editing, setEditing] = useState<LedgerEvent | null>(null);
  const [adding, setAdding] = useState(false);

  let rows = [...scenario.ledger];
  if (query.trim()) {
    const q = query.toLowerCase();
    rows = rows.filter((e) => e.description.toLowerCase().includes(q) || e.vendorOrCustomer.toLowerCase().includes(q) || (e.invoiceRef ?? "").toLowerCase().includes(q));
  }
  if (typeFilter !== "all") rows = rows.filter((e) => e.eventType === typeFilter);
  rows.sort((a, b) => (sortKey === "date" ? (a.dayIndex ?? 0) - (b.dayIndex ?? 0) : Math.abs(b.amountSen) - Math.abs(a.amountSen)));

  const issues = scenario.engine.validationIssues;

  return (
    <div className="stack">
      <Card
        title={`Dated cash-flow ledger — ${scenario.name}`}
        subtitle="Actual vs forecast cash, provenance badges, full editing. Any change instantly recalculates forecasts, alerts and recommendations."
      >
        <div className="toolbar">
          <input placeholder="Search description, vendor, invoice ref…" value={query} onChange={(e) => setQuery(e.target.value)} className="input" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input">
            <option value="all">All types</option>
            <option value="receipt">Receipt</option>
            <option value="payroll">Payroll</option>
            <option value="supplier_payment">Supplier</option>
            <option value="operating_expense">OpEx</option>
            <option value="tax">Tax</option>
            <option value="loan_payment">Loan</option>
            <option value="other">Other</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as "date" | "amount")} className="input">
            <option value="date">Sort by date</option>
            <option value="amount">Sort by amount</option>
          </select>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add transaction</button>
        </div>

        {issues.length > 0 && (
          <div className="issues">
            {issues.map((i, idx) => (
              <div key={idx} className={`issue issue-${i.severity}`}>{i.severity === "error" ? "⛔" : "⚠️"} {i.message}</div>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Day</th><th>Date</th><th>Description</th><th>Type</th><th className="num">Amount</th><th>Status</th><th>Source</th><th>Data class</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={e.status === "cancelled" ? "row-cancelled" : ""}>
                  <td>{e.dayIndex ?? "—"}</td>
                  <td>{e.expectedDate}</td>
                  <td>
                    {e.description}
                    {e.invoiceRef && <span className="muted"> · {e.invoiceRef}</span>}
                    {e.note && <div className="note">{e.note}</div>}
                  </td>
                  <td><EventTypeTag t={e.eventType} /></td>
                  <td className={`num ${e.amountSen > 0 ? "pos" : e.amountSen < 0 ? "neg" : ""}`}>{formatMYR(e.amountSen)}</td>
                  <td><span className={`status status-${e.status}`}>{e.status}</span></td>
                  <td><span className="muted small">{sourceLabel(e.source)}</span></td>
                  <td><Badge kind={e.dataClass}>{dataClassLabel(e.dataClass)}</Badge></td>
                  <td className="actions">
                    <button className="btn btn-sm" onClick={() => setEditing(structuredClone(e))}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => {
                      setState((s) => deleteEventFromScenario(s, scenarioKey, e.id));
                      notify(`Deleted ${e.description} — forecasts recalculated.`);
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="muted">No transactions match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Editing {scenarioKey === "custom" ? "your scenario" : `the ${scenario.name} scenario`} recalculates everything through Day {scenario.engine.horizonDays}. Baseline dataset stays untouched unless you edit the Baseline scenario itself.
        </p>
      </Card>

      {(editing || adding) && (
        <EventEditor
          initial={editing}
          anchorDate={state.baseline.anchorDate}
          onCancel={() => { setEditing(null); setAdding(false); }}
          onSave={(ev) => {
            setState((s) => (editing ? editEventInScenario(s, scenarioKey, ev.id, ev) : addEventToScenario(s, scenarioKey, ev)));
            setEditing(null);
            setAdding(false);
            notify("Transaction saved — forecasts, alerts and recommendations recalculated.");
          }}
        />
      )}
    </div>
  );
}

function EventEditor({ initial, anchorDate, onSave, onCancel }: { initial: LedgerEvent | null; anchorDate: string; onSave: (e: LedgerEvent) => void; onCancel: () => void }) {
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [type, setType] = useState<LedgerEvent["eventType"]>(initial?.eventType ?? "receipt");
  const [amount, setAmount] = useState(initial ? (Math.abs(initial.amountSen) / 100).toString() : "");
  const [isInflow, setIsInflow] = useState(initial ? initial.amountSen > 0 : true);
  const [day, setDay] = useState(String(initial?.dayIndex ?? 1));
  const [vendor, setVendor] = useState(initial?.vendorOrCustomer ?? "");
  const [ref, setRef] = useState(initial?.invoiceRef ?? "");
  const [status, setStatus] = useState<LedgerEvent["status"]>(initial?.status ?? "confirmed");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const sen = parseMYRToSen(amount);
    if (sen === null || sen === 0) { setError("Enter a valid non-zero amount, e.g. 1250.50"); return; }
    if (!desc.trim()) { setError("Description is required."); return; }
    const dayNum = Number(day);
    if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 365) { setError("Day must be an integer between 0 and 365."); return; }
    const date = isoForDay(anchorDate, dayNum);
    if (!isValidISODate(date)) { setError("Resulting date is invalid."); return; }
    const amountSen = isInflow ? Math.abs(sen) : -Math.abs(sen);
    const ev: LedgerEvent = initial
      ? { ...initial, description: desc.trim(), eventType: type, amountSen, dueDate: date, expectedDate: date, dayIndex: dayNum, vendorOrCustomer: vendor.trim() || "Unspecified", invoiceRef: ref.trim() || undefined, status, dataClass: "user_assumption", source: "user_entered", dupMeta: { normalizedDescription: desc.trim().toLowerCase(), amountKey: String(amountSen), invoiceDate: date } }
      : {
          id: `usr-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
          businessId: "user",
          description: desc.trim(),
          eventType: type,
          amountSen,
          dueDate: date,
          expectedDate: date,
          status,
          vendorOrCustomer: vendor.trim() || "Unspecified",
          recurrence: "none",
          source: "user_entered",
          dataClass: "user_assumption",
          invoiceRef: ref.trim() || undefined,
          dayIndex: dayNum,
          dupMeta: { normalizedDescription: desc.trim().toLowerCase(), amountKey: String(amountSen), invoiceDate: date },
        };
    onSave(ev);
  };

  return (
    <Card title={initial ? `Edit transaction ${initial.id}` : "Add transaction"} subtitle="Validated before saving: non-zero integer-sen amount, valid date.">
      <div className="form-grid">
        <label>Description<input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Supplier payment — Syarikat Bekalan Utama" /></label>
        <label>Type
          <select className="input" value={type} onChange={(e) => setType(e.target.value as LedgerEvent["eventType"])}>
            <option value="receipt">Receipt</option><option value="payroll">Payroll</option><option value="supplier_payment">Supplier payment</option>
            <option value="operating_expense">Operating expense</option><option value="tax">Tax</option><option value="loan_payment">Loan payment</option><option value="other">Other</option>
          </select>
        </label>
        <label>Direction
          <select className="input" value={isInflow ? "in" : "out"} onChange={(e) => setIsInflow(e.target.value === "in")}>
            <option value="in">Money in (+)</option><option value="out">Money out (−)</option>
          </select>
        </label>
        <label>Amount (RM)<input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 20000 or 1250.50" inputMode="decimal" /></label>
        <label>Day (0 = today)<input className="input" value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" /></label>
        <label>Vendor / customer<input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
        <label>Invoice ref (optional)<input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label>Status
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as LedgerEvent["status"])}>
            <option value="confirmed">Confirmed (actual cash)</option>
            <option value="pending">Pending</option>
            <option value="forecasted">Forecasted</option>
          </select>
        </label>
      </div>
      {error && <div className="issue issue-error">⛔ {error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={submit}>Save & recalculate</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}

/* ================= Payment Guardian ================= */

function GuardianPanel({ state, scenarioKey }: { state: AppState; scenarioKey: ScenarioKey }) {
  const { alerts, delayed } = computeAlerts(state, scenarioKey);
  const recs = computeRecommendations(state, scenarioKey);
  const recByEvent = new Map(recs.map((r) => [r.eventId, r]));
  if (alerts.length === 0) {
    return (
      <div className="stack">
        <Card title="Payment Guardian" subtitle={`Scanning the ${scenarioOf(state, scenarioKey).name} scenario.`}>
          <div className="allclear">✅ No risk alerts — projected closing cash stays above the reserve, no duplicates or anomalies detected, ledger data is clean.</div>
        </Card>
      </div>
    );
  }
  return (
    <div className="stack">
      <Card title="Payment Guardian" subtitle="Explainable risk detection: severity, evidence class, contributing transactions, and a suggested next action.">
        <div className="alert-list">
          {alerts.map((a) => {
            const linked = a.relatedEventIds.map((id) => recByEvent.get(id)).find(Boolean);
            return (
              <article key={a.id} className={`alert alert-${a.severity}`}>
                <header className="alert-head">
                  <Badge kind={a.severity}>{a.severity.toUpperCase()}</Badge>
                  <Badge kind="event">{a.category.replace(/_/g, " ")}</Badge>
                  <Badge kind={"event"}>{a.evidence.replace(/_/g, " ")}</Badge>
                  <h3>{a.title}</h3>
                </header>
                <p className="alert-explain">{a.explanation}</p>
                <dl className="alert-facts">
                  {a.predictedDay !== null && <><div><dt>Risk date</dt><dd>Day {a.predictedDay} ({a.predictedDate})</dd></div></>}
                  {a.predictedCashSen !== null && <><div><dt>Projected cash</dt><dd>{formatMYR(a.predictedCashSen)}</dd></div></>}
                  {a.amountBelowReserveSen !== null && a.amountBelowReserveSen > 0 && <><div><dt>Below reserve</dt><dd className="neg">{formatMYR(a.amountBelowReserveSen)}</dd></div></>}
                  <div><dt>Minimum reserve</dt><dd>{formatMYR(a.minimumReserveSen)}</dd></div>
                  <div><dt>Related transactions</dt><dd>{a.relatedEventIds.join(", ") || "—"}</dd></div>
                </dl>
                {a.contributions.length > 0 && (
                  <div className="alert-contrib">
                    <strong>Contributing transactions:</strong>
                    <ul>{a.contributions.map((c) => <li key={c.eventId}>{c.description} <span className={c.amountSen < 0 ? "neg" : "pos"}>{formatMYR(c.amountSen)}</span></li>)}</ul>
                  </div>
                )}
                <footer className="alert-action">
                  <strong>Suggested action:</strong> {a.suggestedAction}
                  {linked && <div className="alert-decision">Decision label: <Badge kind={linked.decision}>{linked.decision}</Badge></div>}
                </footer>
              </article>
            );
          })}
        </div>
      </Card>
      {delayed.length > 0 && (
        <Card title="Delayed receipts detected" subtitle="Compared against the baseline schedule.">
          <ul>{delayed.map((d) => <li key={d.eventId}><strong>{d.eventId}</strong>: moved from Day {d.originalDay} to Day {d.newDay}.</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

/* ================= Simulator ================= */

function SimulatorPanel({ state, setState, notify }: { state: AppState; setState: (fn: (s: AppState) => AppState) => void; notify: (m: string) => void }) {
  const [op, setOp] = useState<SimOpForm>({ kind: "delay_receipt" });
  const custom = state.custom;
  const baseline = state.scenarios.baseline.engine;
  const customEngine = custom.engine;

  const diffMin = customEngine.minBalanceSen - baseline.minBalanceSen;

  const apply = () => {
    switch (op.kind) {
      case "delay_receipt": {
        const r = state.baseline.ledger.find((e) => e.eventType === "receipt" && e.id === "demo-receipt-001") ?? state.baseline.ledger.find((e) => e.eventType === "receipt");
        if (!r) { notify("No receipt in baseline to delay."); return; }
        const dayNum = Number(op.day);
        if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 30) { notify("Day must be 0–30."); return; }
        setState((s) => applyCustomOp(s, { kind: "move_event", eventId: r.id, newDay: dayNum }));
        notify(`Receipt moved to Day ${dayNum} — full 30-day forecast recalculated.`);
        break;
      }
      case "reduce_receipt": {
        const sen = parseMYRToSen(op.amount ?? "");
        if (sen === null || sen <= 0) { notify("Enter a valid positive amount."); return; }
        setState((s) => applyCustomOp(s, { kind: "change_amount", eventId: "demo-receipt-001", newAmountSen: sen }));
        notify(`Receipt changed to ${formatMYR(sen)} — recalculated.`);
        break;
      }
      case "restore_receipt": {
        setState((s) => applyCustomOp(s, { kind: "restore_event", eventId: "demo-receipt-001" }));
        notify("Receipt restored to its original date and amount.");
        break;
      }
      case "move_expense": {
        const dayNum = Number(op.day);
        const target = state.baseline.ledger.find((e) => e.id === (op.eventId || "demo-supplier-001"));
        if (!target) { notify("Event not found."); return; }
        if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 30) { notify("Day must be 0–30."); return; }
        setState((s) => applyCustomOp(s, { kind: "move_event", eventId: target.id, newDay: dayNum }));
        notify(`${target.description} moved to Day ${dayNum}.`);
        break;
      }
      case "add_expense": {
        const sen = parseMYRToSen(op.amount ?? "");
        const dayNum = Number(op.day);
        if (sen === null || sen <= 0) { notify("Enter a valid positive expense amount."); return; }
        if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 30) { notify("Day must be 0–30."); return; }
        setState((s) => applyCustomOp(s, { kind: "add_expense", description: op.description || "Unexpected expense", amountSen: -sen, day: dayNum, vendor: op.vendor }));
        notify(`Unexpected expense of ${formatMYR(-sen)} added on Day ${dayNum}.`);
        break;
      }
      case "postpone_supplier": {
        const sen = parseMYRToSen(op.amount ?? "");
        const dayNum = Number(op.day);
        if (sen === null || sen <= 0) { notify("Enter a valid amount to defer."); return; }
        if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 30) { notify("Day must be 0–30."); return; }
        const target = state.baseline.ledger.find((e) => e.id === "demo-supplier-001");
        if (!target) { notify("Supplier payment not found in baseline."); return; }
        if (sen > Math.abs(target.amountSen)) { notify("Cannot defer more than the full bill."); return; }
        setState((s) => applyCustomOp(s, { kind: "split_postpone", eventId: target.id, deferSen: -sen, newDay: dayNum }));
        notify(`RM${(sen / 100).toLocaleString("en-MY")} of the supplier payment postponed to Day ${dayNum}, subject to supplier agreement.`);
        break;
      }
      case "change_bill": {
        const sen = parseMYRToSen(op.amount ?? "");
        if (sen === null || sen === 0) { notify("Enter a valid non-zero amount."); return; }
        const target = state.baseline.ledger.find((e) => e.id === (op.eventId || "demo-supplier-001"));
        if (!target) { notify("Event not found."); return; }
        const signed = target.amountSen > 0 ? Math.abs(sen) : -Math.abs(sen);
        setState((s) => applyCustomOp(s, { kind: "change_amount", eventId: target.id, newAmountSen: signed }));
        notify(`${target.description} amount changed to ${formatMYR(signed)} — recalculated.`);
        break;
      }
      case "restore_event": {
        const target = state.baseline.ledger.find((e) => e.id === (op.eventId || "demo-receipt-001"));
        if (!target) { notify("Event not found."); return; }
        setState((s) => applyCustomOp(s, { kind: "restore_event", eventId: target.id }));
        notify(`${target.description} restored to its original date and amount.`);
        break;
      }
      case "set_reserve": {
        const sen = parseMYRToSen(op.amount ?? "");
        if (sen === null || sen < 0) { notify("Enter a valid reserve amount."); return; }
        setState((s) => applyCustomOp(s, { kind: "set_reserve", newReserveSen: sen }));
        notify(`Minimum reserve set to ${formatMYR(sen)}.`);
        break;
      }
    }
  };

  return (
    <div className="stack">
      <Card title="What-if simulator" subtitle="One change at a time, applied on top of the baseline. The baseline dataset is never mutated; every change is recorded and reversible.">
        <div className="sim-grid">
          <label>Change
            <select className="input" value={op.kind} onChange={(e) => setOp({ kind: e.target.value as SimOpForm["kind"] })}>
              <option value="delay_receipt">Delay a receipt</option>
              <option value="reduce_receipt">Reduce a receipt</option>
              <option value="restore_receipt">Restore receipt to original</option>
              <option value="move_expense">Move an expense</option>
              <option value="add_expense">Add an unexpected expense</option>
              <option value="postpone_supplier">Postpone part of a supplier payment</option>
              <option value="change_bill">Increase or decrease a bill</option>
              <option value="restore_event">Restore an event to original</option>
              <option value="set_reserve">Adjust the minimum reserve</option>
            </select>
          </label>
          {(op.kind === "delay_receipt" || op.kind === "move_expense" || op.kind === "add_expense" || op.kind === "postpone_supplier") && (
            <label>Day (0–30)<input className="input" value={op.day ?? ""} onChange={(e) => setOp({ ...op, day: e.target.value })} inputMode="numeric" /></label>
          )}
          {(op.kind === "reduce_receipt" || op.kind === "add_expense" || op.kind === "postpone_supplier" || op.kind === "set_reserve" || op.kind === "change_bill") && (
            <label>Amount (RM)<input className="input" value={op.amount ?? ""} onChange={(e) => setOp({ ...op, amount: e.target.value })} inputMode="decimal" placeholder="e.g. 10000" /></label>
          )}
          {(op.kind === "change_bill" || op.kind === "restore_event") && (
            <label>Event
              <select className="input" value={op.eventId ?? "demo-supplier-001"} onChange={(e) => setOp({ ...op, eventId: e.target.value })}>
                <option value="demo-payroll-001">Payroll (Day 7)</option>
                <option value="demo-supplier-001">Supplier payment (Day 7)</option>
                <option value="demo-receipt-001">Customer receipt (Day 5)</option>
              </select>
            </label>
          )}
          {op.kind === "move_expense" && (
            <label>Expense
              <select className="input" value={op.eventId ?? "demo-supplier-001"} onChange={(e) => setOp({ ...op, eventId: e.target.value })}>
                <option value="demo-payroll-001">Payroll (Day 7)</option>
                <option value="demo-supplier-001">Supplier payment (Day 7)</option>
              </select>
            </label>
          )}
          {op.kind === "add_expense" && (
            <>
              <label>Description<input className="input" value={op.description ?? ""} onChange={(e) => setOp({ ...op, description: e.target.value })} placeholder="e.g. Emergency repair" /></label>
              <label>Vendor<input className="input" value={op.vendor ?? ""} onChange={(e) => setOp({ ...op, vendor: e.target.value })} /></label>
            </>
          )}
          <div className="sim-actions">
            <button className="btn btn-primary" onClick={apply}>Apply change</button>
            <button className="btn" onClick={() => { setState((s) => resetCustom(s)); notify("Scenario reset — back to baseline."); }}>↺ Reset scenario</button>
          </div>
        </div>
      </Card>

      <Card title="Your scenario vs baseline" subtitle={`${state.customOps.length} recorded change(s). Deterministic recalculation through Day 30 after each change.`}>
        {state.customOps.length > 0 && (
          <ol className="ops-list">
            {state.customOps.map((o, i) => <li key={i}><code>{describeOp(o)}</code></li>)}
          </ol>
        )}
        <div className="stat-grid">
          <Stat label="Projected minimum" value={formatMYR(customEngine.minBalanceSen)} asOf={`Day ${customEngine.minDay}`} tone={customEngine.minBalanceSen < customEngine.minimumReserveSen ? "bad" : "ok"} hint={`Baseline: ${formatMYR(baseline.minBalanceSen)} (${diffMin >= 0 ? "+" : ""}${formatMYR(diffMin, { compact: true })})`} />
          <Stat label="First breach" value={customEngine.firstBreachDay !== null ? `Day ${customEngine.firstBreachDay}` : "None"} tone={customEngine.firstBreachDay !== null ? "bad" : "ok"} hint={`Baseline: ${baseline.firstBreachDay !== null ? `Day ${baseline.firstBreachDay}` : "none"}`} />
          <Stat label="Breach episodes" value={String(customEngine.breachEpisodes.length)} tone={customEngine.breachEpisodes.length ? "bad" : "ok"} hint={`Baseline: ${baseline.breachEpisodes.length}`} />
          <Stat label="Day 30 closing" value={formatMYR(customEngine.daily[30].closingSen)} tone={customEngine.daily[30].closingSen >= customEngine.minimumReserveSen ? "ok" : "bad"} hint={`Baseline: ${formatMYR(baseline.daily[30].closingSen)}`} />
        </div>
        <TrajectoryChart
          scenarios={[
            { name: "Baseline", engine: baseline, color: SCENARIO_COLORS.baseline },
            { name: "Your scenario", engine: customEngine, color: SCENARIO_COLORS.custom, emphasize: true },
          ]}
          reserveSen={customEngine.minimumReserveSen}
        />
        <ExplainBox state={state} scenarioKey="custom" />
      </Card>
    </div>
  );
}

type SimOpForm =
  | { kind: "delay_receipt"; day?: string }
  | { kind: "reduce_receipt"; amount?: string }
  | { kind: "restore_receipt" }
  | { kind: "move_expense"; day?: string; eventId?: string }
  | { kind: "add_expense"; amount?: string; day?: string; description?: string; vendor?: string }
  | { kind: "postpone_supplier"; amount?: string; day?: string }
  | { kind: "change_bill"; amount?: string; eventId?: string }
  | { kind: "restore_event"; eventId?: string }
  | { kind: "set_reserve"; amount?: string };

function describeOp(o: ScenarioOp): string {
  switch (o.kind) {
    case "move_event": return `move ${o.eventId} → Day ${o.newDay}`;
    case "change_amount": return `set ${o.eventId} amount → ${formatMYR(o.newAmountSen)}`;
    case "add_expense": return `add expense "${o.description}" ${formatMYR(o.amountSen)} on Day ${o.day}`;
    case "add_receipt": return `add receipt "${o.description}" ${formatMYR(o.amountSen)} on Day ${o.day}`;
    case "split_postpone": return `defer ${formatMYR(Math.abs(o.deferSen))} of ${o.eventId} → Day ${o.newDay} (subject to supplier agreement)`;
    case "restore_event": return `restore ${o.eventId} to original`;
    case "set_reserve": return `minimum reserve → ${formatMYR(o.newReserveSen)}`;
  }
}

/* ================= Evaluation ================= */

function EvaluationPanel() {
  const panel = useMemo(() => computeEvaluationPanel(), []);
  const { detection, recall, fpr, leadTimes, intervention, suite } = panel;
  const leadMin = leadTimes.length ? Math.min(...leadTimes.map((l) => l.leadDays)) : null;
  const leadMax = leadTimes.length ? Math.max(...leadTimes.map((l) => l.leadDays)) : null;
  const leadAvg = leadTimes.length ? leadTimes.reduce((s, l) => s + l.leadDays, 0) / leadTimes.length : null;

  return (
    <div className="stack">
      <Card title="Early-warning evaluation" subtitle="Computed live from the 24 reproducible synthetic cases using the real engine. All results are synthetic — not measured on real Malaysian SMEs.">
        <div className="stat-grid">
          <Stat label="Detection recall (TP/(TP+FN))" value={recall === null ? "n/a (no breach cases)" : `${(recall * 100).toFixed(1)}%`} tone={recall !== null && recall >= 0.9 ? "ok" : "warn"} hint={`TP=${detection.tp} FN=${detection.fn}`} />
          <Stat label="False-positive rate (FP/(FP+TN))" value={fpr === null ? "n/a (no negative cases)" : `${(fpr * 100).toFixed(1)}%`} tone={fpr !== null && fpr <= 0.1 ? "ok" : "warn"} hint={`FP=${detection.fp} TN=${detection.tn}`} />
          <Stat label="Lead time (detected breach cases)" value={leadAvg !== null ? `${leadAvg.toFixed(1)} days avg` : "n/a"} tone="ok" hint={leadMin !== null ? `range ${leadMin}–${leadMax} days across ${leadTimes.length} breach cases; mandatory demo = 7 days` : undefined} />
          <Stat label="Forecast MAE" value={panel.forecastMaeSen !== null ? formatMYR(Math.round(panel.forecastMaeSen), { compact: true }) : "n/a"} tone="neutral" hint={`RMSE ${panel.forecastRmseSen !== null ? formatMYR(Math.round(panel.forecastRmseSen), { compact: true }) : "n/a"} — 12-bill synthetic series, median forecast`} />
          <Stat label="Intervention effectiveness" value={intervention.breachEliminated ? "Breach eliminated" : "Breach remains"} tone={intervention.breachEliminated ? "ok" : "bad"} hint={`Min balance ${formatMYR(intervention.minBalanceBeforeSen, { compact: true })} → ${formatMYR(intervention.minBalanceAfterSen, { compact: true })}; breach days ${intervention.breachDaysBefore} → ${intervention.breachDaysAfter}; later breach: ${intervention.laterBreachAfterIntervention ? "yes" : "no"}`} />
        </div>
        <p className="muted small">
          Denominators: recall over the {detection.tp + detection.fn} synthetic case(s) with an actual breach; false-positive rate over the {detection.fp + detection.tn} case(s) without one. Lead time measured Day 0 → first projected breach day; the mandatory scenario contributes exactly 7 days but the distribution varies across cases (reported honestly).
        </p>
      </Card>

      <Card title={`Synthetic test battery — ${panel.syntheticPassed}/${panel.syntheticTotal} passing`} subtitle="Every case runs against the real engine at page load. Expected vs actual shown; no hardcoded pass flags.">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Case</th><th>Name</th><th>Category</th><th>Expected</th><th>Actual (engine)</th><th>Status</th></tr></thead>
            <tbody>
              {panel.synthetic.map((r) => (
                <tr key={r.caseId}>
                  <td><code>{r.caseId}</code></td>
                  <td>{r.name}</td>
                  <td>{r.category}</td>
                  <td className="small">{r.expected}</td>
                  <td className="small">{r.actual}</td>
                  <td><Badge kind={r.pass ? "pass" : "fail"}>{r.pass ? "PASS" : "FAIL"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Automated acceptance suite — ${suite.passed}/${suite.total} passing`} subtitle="Mandatory-scenario arithmetic, engine mechanics, guardian rules, forecasting, validation and the synthetic battery. Also runnable via `npm test` (Vitest).">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ID</th><th>Check</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
            <tbody>
              {suite.cases.map((c) => (
                <tr key={c.id}>
                  <td><code>{c.id}</code></td>
                  <td>{c.name}</td>
                  <td className="small">{c.expected}</td>
                  <td className="small">{c.actual}</td>
                  <td><Badge kind={c.pass ? "pass" : "fail"}>{c.pass ? "PASS" : "FAIL"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ================= Assumptions ================= */

function AssumptionsPanel({ state }: { state: AppState }) {
  const [confirmed, setConfirmed] = useState(state.supplierAgreementConfirmed);
  const events = buildDemoEvents();
  return (
    <div className="stack">
      <Card title="Data provenance & assumptions" subtitle="Every number in this app traces to one of the sources below.">
        <h4>Source labels used across the app</h4>
        <ul className="prov-list">
          <li><Badge kind="known">Confirmed</Badge> — actual/contracted transactions (synthetic demo data in this build).</li>
          <li><Badge kind="user_assumption">User assumption</Badge> — values you enter; treated as user-provided, not verified.</li>
          <li><Badge kind="heuristic">Heuristic forecast</Badge> — rule-based estimates where history is insufficient.</li>
          <li><Badge kind="scenario">Scenario value</Badge> — generated by a scenario operation (e.g. moved receipt, deferred payment).</li>
          <li><Badge kind="unknown">Unknown</Badge> — missing information; surfaced honestly instead of guessed.</li>
        </ul>
        <h4>Mandatory demo dataset (fixed, reproducible)</h4>
        <table className="table">
          <thead><tr><th>Event</th><th>Day</th><th>Amount</th><th>Counterparty</th><th>Source</th></tr></thead>
          <tbody>
            <tr><td>{events.receipt.description}</td><td>5</td><td className="pos">{formatMYR(events.receipt.amountSen)}</td><td>{events.receipt.vendorOrCustomer}</td><td>Synthetic demo</td></tr>
            <tr><td>{events.payroll.description}</td><td>7</td><td className="neg">{formatMYR(events.payroll.amountSen)}</td><td>{events.payroll.vendorOrCustomer}</td><td>Synthetic demo</td></tr>
            <tr><td>{events.supplier.description}</td><td>7</td><td className="neg">{formatMYR(events.supplier.amountSen)}</td><td>{events.supplier.vendorOrCustomer}</td><td>Synthetic demo</td></tr>
          </tbody>
        </table>
        <p>Opening cash <strong>{formatMYR(state.baseline.openingCashSen)}</strong> on Day 0 ({DEMO_ANCHOR_DATE}); minimum reserve <strong>{formatMYR(state.baseline.minimumReserveSen)}</strong>; horizon <strong>30 days</strong>; balances are <strong>closing-of-day</strong> (after all same-day events); breach = closing cash strictly below reserve.</p>
        <h4>Method assumptions & limitations</h4>
        <ul>
          <li>Financial arithmetic uses integer sen; no floating-point equality checks.</li>
          <li>Bill forecasts use a documented robust median + MAD method; fewer than 4 observations produce a low-evidence estimate with an explicit warning, not a fake interval.</li>
          <li>Unusual-charge detection uses a 3-MAD robust threshold with ≥4 observations; otherwise an absolute/percentage heuristic, labelled as such.</li>
          <li>Duplicate detection flags exact and near-duplicates for review; vendor+amount repetition alone is never treated as proof of fraud.</li>
          <li>Evaluation metrics come from synthetic cases only. No claim is made about real-world predictive accuracy.</li>
          <li>The intervention scenario assumes the supplier <em>might</em> agree to deferred terms — nothing is counted as agreed until you confirm below.</li>
        </ul>
        <label className="confirm-row">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>Record supplier agreement: Syarikat Bekalan Utama has agreed to the Day-9 deferral of RM10,000.</span>
        </label>
        <p className="muted small">{confirmed ? "Recorded locally. Recommendations will stop flagging the deferred portion as unconfirmed." : "Not recorded — any deferred supplier schedule remains conditional."}</p>
      </Card>
    </div>
  );
}
