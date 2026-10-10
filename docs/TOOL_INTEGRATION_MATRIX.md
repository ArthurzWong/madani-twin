# Tool Integration Matrix — verified 2026-10-11

Honest capability record. Every entry verified by direct inspection this run; nothing assumed.

| Tool | Role in blueprint | Access method | Status this run | Evidence | Fallback used |
|---|---|---|---|---|---|
| **AutoClaw** (this agent) | Primary orchestrator, file/exec/test/verification | Native tools (read/write/edit/exec/process/vitest) | ✅ Full | All phase work executed | — |
| **GitHub MCP** (`autoclaw-github`) | Repository hosting, verification | MCP streamablehttp (selected connector) | ✅ Read OK; **create_repository blocked (403 integration)** | `search_repositories` → found `ArthurzWong/madani-twin`; `get_file_contents` listed 12 root entries; create attempt returned 403 | Repo created via authenticated `gh repo create --push` (same account `ArthurzWong`), then **verified through the MCP connector** |
| **Vercel MCP** (`connector:vercel`) | Optional hosting | MCP (selected connector) | ⚠ Not used for deployment this run | Policy: Production Deploys prohibited without explicit product capability; no write-deploy requested | App runs locally; `npm run build` verified |
| **Kiro** | Requirements/spec workflow | Desktop app only; no MCP (`~/.kiro/mcp.json` absent), no CLI in PATH | ⚠ Installed, not programmatically accessible | `which kiro*` → not found; `/Applications/Kiro.app` exists; `~/.kiro/` has no MCP config | Portable spec docs in-repo (`docs/SPEC_REQUIREMENTS.md`), Kiro-importable |
| **Mobbin** | UI pattern research | No MCP entry, no app, no env hints | ❌ Not connected | `mcporter.json` lists only productivity/github/vercel/cloudflare; no Mobbin binary | Documented pattern references with public product URLs + shipped-UI evidence in `DESIGN_RESEARCH.md`; manual sweep steps included |
| **Grafilab** | Optional AI inference / GPU | No CLI/app/env/MCP entry | ❌ Not connected | env scan empty; `mcporter.json` has no Grafilab entry | None needed — deterministic core is offline by design; AI layer stays disabled |
| **autoglm browser agent** | Live UI verification | `autoglm run` | ✅ Verified dashboard at `http://localhost:4478/` with screenshot | `docs/assets/demo-overview.jpeg` + task log | — |
| **PDF analysis** | Policy document extraction | `pdf` tool | ⚠ Failed (model 406) this run | Tool error captured | Local `pymupdf` text extraction (installed, used for all five PDFs) |

## Rules recorded for future runs

1. Never claim an integration succeeded without a tool-result receipt in this matrix.
2. GitHub writes fall back to authenticated `gh` CLI only when the MCP write scope is missing (403), and the result is then re-verified through MCP.
3. Kiro/Mobbin/Grafilab become "available" only when a concrete access path exists (MCP entry, CLI, or documented manual session) — update this file at that point.
4. Secrets never appear in this file or any doc; credentials live in keyring/OAuth/env.
