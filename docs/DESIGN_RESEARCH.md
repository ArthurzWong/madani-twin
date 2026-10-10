# Design Research — Financial UI Patterns for MADANI Twin

> **Honest status:** Mobbin was not connected this run (no MCP entry, no app, no credentials — see `TOOL_INTEGRATION_MATRIX.md`). Research below is from the shipped product plus documented, publicly observable product patterns, each with source URL. A manual Mobbin sweep procedure is included at the end for the user to run with a Mobbin account; findings should be appended to this file.

## Studied patterns

### 1. Business-banking dashboard: balance-first hierarchy
- **Studied:** small-business banking overview (Mercury-style: balance hero + projected cash + transaction preview). Reference: https://mercury.com/ (public product pages/tour).
- **Observed pattern:** the *number that matters most* (cash) is the first element; supporting metrics are small, uppercase-labelled cards; timestamps ("as of") on every figure.
- **Fit:** MADANI Twin's brief demands the first screen immediately show the key financial outcome.
- **Adaptation (shipped):** 9-card stat grid led by Current cash (Day 0, dated), Minimum reserve, breach date (red), shortfall, alert count. Every card carries `as of` date or day-index.
- **Not copied:** Mercury's brand visuals, illustrations, marketing layout.

### 2. Cash-flow forecast: multi-line trajectory with a threshold
- **Studied:** cash-flow forecasting views that plot projected balance against a safety threshold with a shaded risk window (e.g. Float / Pulse-style cash charts; Float: https://floatapp.com/). 
- **Observed pattern:** daily line, dashed threshold, shaded band where the projection dips under threshold, min-point marker.
- **Fit:** the core product question is *when* cash breaches the reserve — the chart must answer it at a glance.
- **Adaptation (shipped):** dependency-free SVG chart: 3 scenario lines (green/red/blue; purple for custom), dashed red reserve line, red shaded breach episodes, min-balance dot per scenario, RM-formatted y-axis, Day 0–30 x-axis.
- **Not copied:** any proprietary chart styling or animations.

### 3. Transaction ledger: filterable table with provenance
- **Studied:** Wise/Revolut business transaction lists (status chips, direction colouring, search + type filter). Reference: https://wise.com/business/ (public feature pages).
- **Observed pattern:** dense table, right-aligned tabular numerals, green inflows / red outflows, chip filters, row hover.
- **Fit:** SMEs scan ledgers by date/vendor/amount; provenance matters because the app mixes confirmed vs forecast data.
- **Adaptation (shipped):** ledger table with day/date/description/type/amount/status/**source**/**data-class badge** columns, search + type + sort controls, add/edit/delete with validation issues surfaced inline (never silent).
- **Not copied:** Wise branding, specific iconography.

### 4. Risk alerts: explain-first cards
- **Studied:** fraud/overspend alert cards (Stripe Radar-style: verdict chip + evidence + suggested action; https://stripe.com/radar).
- **Observed pattern:** severity colour on the left border, structured facts grid, explicit "suggested action", evidence classification.
- **Fit:** Payment Guardian must explain *what/when/how much/who/what next* for every alert.
- **Adaptation (shipped):** alert cards with severity badge (critical/warning), category chip, evidence chip (confirmed/estimated/scenario-dependent), facts grid (risk date, projected cash, below-reserve amount, reserve, related IDs), contributing-transaction list with signed amounts, suggested-action footer, linked APPROVE/HOLD/REVIEW decision.
- **Not copied:** Radar's copy or scoring semantics.

### 5. Scenario comparison: switcher + persistent baseline
- **Studied:** plan/feature comparison switchers in fintech onboarding (e.g. Xero plan compare; https://www.xero.com/my/pricing/).
- **Observed pattern:** segmented switcher keeping context visible; comparison table with the active row highlighted.
- **Adaptation (shipped):** 4-segment scenario switcher (Baseline/Downside/Intervention/Custom) + comparison table with active-row highlight; simulator records ops in an auditable list.
- **Not copied:** pricing-page content.

### 6. States: loading/error/empty
- **Studied:** empty-state conventions in finance SaaS (friendly title + one-line explanation + single action).
- **Adaptation (shipped):** "no alerts → ✅ all-clear card"; "no transactions match filters" row; validation issue banners (⛔/⚠️); disabled-safe buttons; synthetic-data banner on every screen; toast confirmations after mutations.

## Design specification (implemented)

- **IA:** Overview → Cash Ledger → Payment Guardian → What-if Simulator → Forecast & Evaluation → Data & Assumptions (single-level tabs; scenario switcher persists above tabs).
- **Tokens:** bg `#f4f6fa`, surface `#fff`, ink `#17233b`, muted `#64748b`, line `#e2e8f0`; green `#2f6f4f` (positive/ok), red `#d64545` (risk/breach), amber `#b7791f` (review/heuristic), blue `#2b6cb0` (intervention/primary), purple `#8a5cc2` (custom scenario); radius 12px; soft two-layer shadow.
- **Typography:** Inter/system stack; uppercase 0.76rem labels; tabular-nums for money; RM formatting everywhere.
- **Chart conventions:** Day 0–30 x-axis with 5-day ticks; RM-compact y ticks; dashed red = reserve; red band = breach; dot = scenario minimum; legend with min value/day.
- **Risk colours:** critical/breach = red, review/heuristic = amber, confirmed-ok = green, scenario-derived = purple, unknown = grey. All badge classes in `styles.css`.
- **Tables & forms:** sticky-free simple tables, hover rows, right-aligned numeric columns, form grids with labelled inputs, inline validation errors before save.
- **Mobile:** stat grid 2-col ≤600px / 1-col cards; scenario switcher stacks; horizontal-scroll tabs and tables; topbar stacks. Desktop-first density, mobile-safe overflow.
- **Accessibility:** semantic buttons/tables; `role=tab/radio` + `aria-selected/checked` on switchers; colour never the sole signal (badges always carry text); focus outline on inputs; high-contrast text pairs.

## Manual Mobbin sweep (when the user has a Mobbin account)

1. Log in at https://mobbin.com → browse **Finance / Banking** collections, desktop + iOS.
2. Capture 5–8 screens per pattern above (dashboard, forecast chart, ledger, alert, scenario/plan compare, empty states) of Malaysian-relevant products first (Maybank2u Business, CIMB BusinessZone, e-wallet SME apps) then regional (Wise, Airwallex, Aspire).
3. Record per screen: source app, URL from Mobbin's share link, pattern notes → append to this file under "Studied patterns".
4. Respect the rule: patterns and IA only — no brand assets, no pixel copying.
