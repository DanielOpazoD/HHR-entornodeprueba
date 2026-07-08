# Maintenance Debt Scorecard

Generated at: 2026-07-05T06:20:05.896Z
Commit: 126d4b82
Worktree: clean

## Pending Hotspots

- None

## Watchlist By Size

- firestore.rules: 891 líneas (limit 1050, 159 líneas libres, source rules-governance)
- src/hooks/useCensusEmailRecipientLists.ts: 132 líneas (limit 180, 48 líneas libres, source hook-hotspot)
- src/features/laboratory/controllers/labAnalyticsController.ts: 35 líneas
- src/hooks/useBedManagementReducer.ts: 17 líneas
- src/features/handoff/components/HandoffRowCells.tsx: 5 líneas
- src/services/repositories/dailyRecordWriteSupport.ts: 2 líneas

## Test Stability Signals

- Flake-risk test files: 0
- Known failure entries: 0
- Open known failure entries: 0

## Legacy Retirement Debt

- Status: ok
- Open surfaces: 4 / 4

- Legacy read bridge: ok (restrict, owner storage/repositories; entrypoints=2/2, importers=1/1) - next: Keep the bridge import surface flat, then remove legacyRecordBridgeService from the daily-record read path after a clean disabled-mode release.
- Role aliases: ok (observe, owner auth/security; governedEntries=4/4, missing=0) - next: Audit production role sources before deleting legacy viewer role compatibility from helpers, Firestore rules and Storage rules.
- Legacy clinical document hydration: ok (restrict, owner clinical-documents; consumers=3/3, unapproved=0) - next: Keep all read/import/workspace hydration behind ClinicalDocumentCompatibilityPort, then retire schema v1 defaults after a clean current-schema release window.
- Legacy episode hydration: ok (restrict, owner census/clinical-documents; consumers=1/1, unapproved=0) - next: Keep legacy episode-key parsing confined to patient-flow; migrate callers to lookup-key helpers and block UI-level ad hoc parsing.

## Firestore Rules Growth

- firestore.rules: 891 / 1050 líneas
- Remaining budget: 159 líneas
- Owner area: sync
- Owned fragments: 11
- Governance issues: none

## Recent Churn (30 Days)

- src/services/repositories/: 60 archivos tocados
- src/features/census/: 54 archivos tocados
- src/hooks/: 52 archivos tocados
- src/features/laboratory/: 6 archivos tocados
- src/features/handoff/: 5 archivos tocados

