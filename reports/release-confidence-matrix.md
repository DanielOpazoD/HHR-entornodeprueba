# Release Confidence Matrix

Generated at: 2026-07-05T06:20:05.119Z
Commit: 126d4b82
Worktree: clean
Overall: ok

## Summary

- Areas: 11
- Critical coverage zones mapped: 15/15
- Blocking release steps mapped: 7/7
- Smoke scenarios mapped: 6/6
- Flow budgets mapped: 6/6
- Technical ownership areas mapped: 11/11

## Areas

| Area | Owner | Coverage zones | Blocking steps | Smoke scenarios | Flow budgets | Validation suites | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth bootstrap y login | auth | src/services/auth, src/services/auth/bootstrap | runtime_smoke, critical_coverage, flow_performance, e2e_critical_ci | cold_boot, login | loginVisibleMs, authFeedbackMs | test:risk:auth | ok |
| Censo y shell inicial | census | src/features/census/controllers, src/app-shell, src/shared/census/upc-critical | runtime_smoke, critical_coverage, flow_performance, e2e_critical_ci | - | censoVisibleMs, censoRecordReadyMs | test:unit:critical, test:e2e:critical:ci | ok |
| Documentos clinicos | clinical-documents | src/features/clinical-documents | runtime_smoke, critical_coverage, flow_performance, e2e_critical_ci | clinical_documents | clinicalDocumentsVisibleMs | test:clinical-documents, test:e2e:critical:ci | ok |
| Sync, Firestore y recovery local | sync | src/services/storage/firestore, src/services/storage/sync-critical, src/services/storage/indexeddb-recovery | runtime_smoke, rules_ci, emulator_sync_ci, critical_coverage | offline_to_online, sync_conflict | - | test:emulator:sync:ci, test:platform-resilience | ok |
| Repositorios y compatibilidad de datos | repositories | src/services/patient-history | emulator_sync_ci, critical_coverage | - | - | test:repository-compat, test:emulator:sync:ci | ok |
| Transfers y derivaciones | transfers | src/services/transfers | critical_coverage | - | - | test:unit:critical | ok |
| Avisos administrativos | reminders-admin | src/features/reminders/admin | critical_coverage | - | - | test:risk:admin-health | ok |
| Handoff medico | handoff | src/features/handoff | critical_coverage | - | - | test:ci:unit | ok |
| Exportacion y respaldo | backup | src/services/backup, src/services/export-manager | runtime_smoke, flow_performance, e2e_critical_ci | export | backupFilesVisibleMs | test:unit:critical, test:e2e:critical:ci | ok |
| Netlify Functions y deploy | serverless | - | serverless_deploy_smoke | - | - | test:serverless-deploy-smoke, test:risk:platform | ok |
| AI clinica y terminologia | ai | - | serverless_deploy_smoke | - | - | test:risk:platform, test:serverless-deploy-smoke | ok |

## Governance gaps

- Unmapped critical coverage zones: -
- Unmapped blocking release steps: -
- Unmapped smoke scenarios: -
- Unmapped flow budgets: -
- Unmapped technical ownership areas: -
