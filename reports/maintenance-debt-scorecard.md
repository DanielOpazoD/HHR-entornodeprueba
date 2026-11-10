# Maintenance Debt Scorecard

Generated at: 2026-11-10T15:35:20.161Z
Commit: 6b9530fa8
Worktree: dirty

## Pending Hotspots

- None

## Watchlist By Size

- firestore.rules: 925 líneas (limit 1050, 125 líneas libres, source rules-governance)
- src/hooks/useCensusEmailRecipientLists.ts: 133 líneas
- src/features/handoff/components/HandoffMedicalObservationsCell.tsx: 131 líneas
- src/services/repositories/dailyRecordPatchPersistenceController.ts: 92 líneas
- src/hooks/useBedManagementReducer.ts: 77 líneas
- src/features/laboratory/controllers/labAnalyticsController.ts: 35 líneas

## Test Stability Signals

- Flake-risk test files: 36

## Legacy Retirement Debt

- Status: ok
- Open surfaces: 3 / 4

- Role aliases: ok (observe, owner auth/security; governedEntries=4/4, missing=0) - next: Audit production role sources before deleting legacy viewer role compatibility from helpers, Firestore rules and Storage rules.
- Legacy clinical document hydration: ok (restrict, owner clinical-documents; consumers=2/2, unapproved=0) - next: Keep all read/import/workspace hydration behind ClinicalDocumentCompatibilityPort, then retire schema v1 defaults after a clean current-schema release window.
- Legacy episode hydration: ok (restrict, owner census/clinical-documents; consumers=1/1, unapproved=0) - next: Keep legacy episode-key parsing confined to patient-flow; migrate callers to lookup-key helpers and block UI-level ad hoc parsing.

## Firestore Rules Growth

- firestore.rules: 925 / 1050 líneas
- Remaining budget: 125 líneas
- Owner area: sync
- Owned fragments: 12
- Governance issues: none

## Recent Churn (30 Days)

- src/features/census/: 659 archivos tocados
- src/hooks/: 186 archivos tocados
- src/services/repositories/: 119 archivos tocados
- src/features/laboratory/: 55 archivos tocados
- src/features/handoff/: 49 archivos tocados

