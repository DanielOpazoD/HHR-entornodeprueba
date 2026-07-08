# Legacy Retirement Debt Snapshot

- Generated: stable:legacy-retirement-debt
- Policy version: 2026-06-v1
- Status: ok
- Open surfaces: 4/4

## Surfaces

| Surface | Owner | Phase | Status | Signal | Next action |
| --- | --- | --- | --- | --- | --- |
| Legacy read bridge | storage/repositories | restrict | ok | entrypoints=2/2, importers=1/1 | Keep the bridge import surface flat, then remove legacyRecordBridgeService from the daily-record read path after a clean disabled-mode release. |
| Role aliases | auth/security | observe | ok | governedEntries=4/4, missing=0 | Audit production role sources before deleting legacy viewer role compatibility from helpers, Firestore rules and Storage rules. |
| Legacy clinical document hydration | clinical-documents | restrict | ok | consumers=3/3, unapproved=0 | Keep all read/import/workspace hydration behind ClinicalDocumentCompatibilityPort, then retire schema v1 defaults after a clean current-schema release window. |
| Legacy episode hydration | census/clinical-documents | restrict | ok | consumers=1/1, unapproved=0 | Keep legacy episode-key parsing confined to patient-flow; migrate callers to lookup-key helpers and block UI-level ad hoc parsing. |

## Evidence

### Legacy read bridge

- Retirement criteria: VITE_LEGACY_COMPATIBILITY_MODE=disabled survives one release window and legacy bridge telemetry shows no required daily-record bridge usage.
- Guardrails: check:legacy-read-gating, check:legacy-bridge-boundary, report:legacy-bridge
- Reports: reports/legacy-bridge-governance.md, reports/legacy-retirement-debt.md

### Role aliases

- Retirement criteria: Two consecutive release snapshots show zero legacy viewer role aliases in production claims and config/roles, then write-back canonicalization can be removed.
- Guardrails: src/tests/security/legacyRoleAliasStatic.test.ts, report:compatibility-governance
- Reports: reports/compatibility-governance.md, reports/legacy-retirement-debt.md

### Legacy clinical document hydration

- Retirement criteria: ClinicalDocumentRepository reads only current schema records for one release window and the compatibility port no longer sees legacy audit actor defaults in production telemetry.
- Guardrails: test:clinical-documents, check:clinical-documents-feature-boundary, check:runtime-contracts
- Reports: reports/runtime-contracts.md, reports/legacy-retirement-debt.md

### Legacy episode hydration

- Retirement criteria: All active patients carry canonical clinicalEpisodeId and document lookup no longer needs RUT/admission-date fallback keys.
- Guardrails: src/tests/security/clinicalEpisodeKeyGovernanceStatic.test.ts, test:clinical-documents, check:runtime-contracts
- Reports: reports/runtime-contracts.md, reports/legacy-retirement-debt.md
