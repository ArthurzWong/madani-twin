# MADANI Twin — Build Plan & Phase Status

**Product:** MADANI Twin — predictive cash-flow decision engine for Malaysian SMEs
**Track:** Dormathon 2026 Track 1 — Predict Early, Decide Better
**Single source of truth:** this repository (`ArthurzWong/madani-twin`). All specifications live here; no parallel projects.

## Phase 0 — Discover the environment ✅ 2026-10-11

| Check | Result |
|---|---|
| Repository inspected before any change | Existing, working app (React 18 + TypeScript + Vite + Vitest) built and committed in the previous session; commit `9434496`. Reused as the canonical implementation — no rebuild. |
| Runtime / package manager | Node v26.4.0, npm 11.x, bun available; project uses npm. |
| Tests at start | 49/49 passing (45 engine + 4 UI smoke) via Vitest 2.1.9. Re-verified this session. |
| AutoClaw tools available | File tools, exec, process, web_search, cron, image, pdf (⚠ returns model 406 this run), GitHub MCP (`autoclaw-github`), Vercel MCP (`connector:vercel`), Cloudflare MCP, productivity MCP (Gmail/Calendar/Workspace). Browser automation via `autoglm` (verified working). |
| Kiro | Kiro.app installed (`/Applications/Kiro.app`), no `~/.kiro/mcp.json`, no CLI in PATH, no MCP server exposed → **not programmatically accessible**. Spec duties covered by portable markdown specs in `docs/` (Phase 2). |
| Grafilab | No CLI, no app, no env vars, no MCP entry in `mcporter.json` → **not accessible**. Deterministic core needs no AI; optional AI layer stays disabled (by design). Status recorded in `TOOL_INTEGRATION_MATRIX.md`. |
| Mobbin | Not connected (no MCP entry, no app). Design research done from the shipped app + documented pattern references with URLs → see `DESIGN_RESEARCH.md`. Manual path documented for the user. |
| GitHub connector | ✅ Verified: user `ArthurzWong`, repo search + file listing via MCP; repo `ArthurzWong/madani-twin` created and pushed. |
| Secrets exposure | None. No keys/tokens in docs; GitHub token stays in keyring; Vercel/Cloudflare use OAuth connectors. |

**Files changed in Phase 0:** `docs/BUILD_PLAN.md` (this file), `docs/TOOL_INTEGRATION_MATRIX.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_DECISIONS.md`.

## Phase 1 — Design research (Mobbin-path) ✅ 2026-10-11

`docs/DESIGN_RESEARCH.md` created: pattern study across business-banking and cash-flow products (Mercury-style dashboards, Wise/Maybank2u ledger patterns, Stripe-style alert cards), design specification (IA, tokens, components, chart conventions, risk colours, states). **Honest status:** no live Mobbin session this run (connector absent); references are documented product URLs + the implemented, shipped UI as evidence. Manual Mobbin sweep instructions included for the user.

## Phase 2 — Requirements & specification (Kiro-path) ✅ 2026-10-11

Kiro is installed but has no accessible MCP/API surface, so the specification was produced in Kiro-compatible portable form inside this repo:
- `docs/SPEC_REQUIREMENTS.md` — user stories + acceptance criteria in six requirement groups (engine / scenarios / forecasting+anomaly / UI / evaluation / optional AI), engine requirements explicitly covering integer-sen, deterministic ordering, closing-cash formula, strict breach semantics, calendar-day lead time, scenario isolation, Day-30 future-breach detection, honest test reporting.
- `docs/TEST_REPORT.md` — actual executed results mapping each requirement → test → result.
- Mandatory demo values preserved exactly (RM50,000 / RM10,000 / +20,000 D5 / −25,000 D7 / −20,000 D7 → 25,000; downside 5,000 + 5,000 shortfall + 7-day lead; intervention 15,000/25,000/25,000, none below reserve; inadequate-intervention case proves later-breach detection).

## Phase 3 — Grafilab capability verification ✅ 2026-10-11

Not accessible (no account hook, CLI, MCP, or credentials in env). Deterministic core requires no inference; the optional AI layer (invoice text extraction, plain-English explanations) remains **disabled by default** with a clean seam (`recommend.ts` explanation builders, `guardianDeps` isolation). If the user later provides Grafilab access, integration must follow the rules in `SPEC_REQUIREMENTS.md` §6: env-var credentials, timeouts, deterministic fallback, validation, no authority over balances/approvals.

## Phase 4 — Implementation ✅ (previous session, re-verified)

Existing canonical implementation reused; all 10 blueprint modules present and engine-driven. Sequence followed matches the recommended order (data model → engine → scenarios → forecasting/anomaly → recommendations → UI → evaluation → optional integrations deliberately skipped).

## Phase 5 — Mandatory demonstration ✅

One-click **Run MADANI Demo** (loads on first visit) + **Reset Demo**. All mandatory values engine-verified this session: Baseline D7 RM25,000; Downside D7 RM5,000, shortfall RM5,000, lead 7 days; Intervention D7 RM15,000, D9 RM25,000, D30 RM25,000, zero breaches; inadequate-intervention later-breach case (`case-18`) passing. Browser-verified screenshot in `docs/assets/demo-overview.jpeg`.

## Phase 6 — Quality assurance ✅

24 reproducible synthetic cases (fixed datasets, no RNG) + 31 acceptance checks + 49 Vitest tests, **all passing** (re-run this session). Metrics (recall, FPR, lead-time distribution, MAE/RMSE, intervention effectiveness) computed live with explicit denominators and honest n/a handling. All labelled synthetic.

## Phase 7 — Integration & handoff ✅ 2026-10-11

Repo `ArthurzWong/madani-twin` (public) created via `gh` + verified via GitHub MCP; main pushed. This turn adds: `docs/BUILD_PLAN.md`, `docs/TOOL_INTEGRATION_MATRIX.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_DECISIONS.md`, `docs/DESIGN_RESEARCH.md`, `docs/SPEC_REQUIREMENTS.md`, `docs/DATA_DICTIONARY.md`, `docs/POLICY_ALIGNMENT.md`, `docs/TEST_REPORT.md` (update). Phase statuses maintained in this file.

## Phase 8 — Final acceptance ✅

- App starts (`npm run dev` → :5173; `npm run build` + `preview` verified HTTP 200).
- Engine produces all mandatory values (re-verified in-process this session).
- Interface functional + responsive (browser-verified desktop; responsive CSS grid).
- Receipt-date change updates forecast live (simulator + ledger edits).
- Intervention tested through Day 30 (later-breach case included).
- ≥20 reproducible synthetic cases (24). Automated tests actually run (49/49).
- README has exact run instructions. External AI optional and absent.
- Integration status reported truthfully in `TOOL_INTEGRATION_MATRIX.md`.

**Unresolved / user actions needed:** none blocking. Optional: live Mobbin sweep (needs Mobbin account), Kiro spec import (needs Kiro MCP enablement), Grafilab AI layer (needs account + justified workload), Vercel deployment (needs user-approved project creation — connector selected but write-deploy requires explicit confirmation per policy).
