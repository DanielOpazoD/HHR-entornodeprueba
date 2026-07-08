# Technical Ownership Map

Generated at: 2026-07-05T06:17:55.749Z
Areas: 11

| Area | Owner | Primary metric | Gates | Runbooks |
| --- | --- | --- | --- | --- |
| auth | auth | loginVisibleMs, authFeedbackMs | check:critical-coverage, test:release-confidence | docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md, docs/RUNBOOK_OPERATIONAL_BUDGETS.md |
| sync | storage | offline_to_online smoke, sync queue budgets | test:smoke:critical-runtime, test:emulator:sync:ci, check:flow-performance-budget | docs/RUNBOOK_SYNC_RESILIENCE.md, docs/RUNBOOK_OPERATIONAL_BUDGETS.md |
| repositories | repositories | critical repository coverage and emulator sync | check:quality, test:emulator:sync:ci | docs/RUNBOOK_SYNC_RESILIENCE.md |
| clinical-documents | clinical-documents | clinicalDocumentsVisibleMs | check:critical-coverage, test:smoke:critical-runtime, test:e2e:critical:ci | docs/RUNBOOK_OPERATIONAL_BUDGETS.md |
| census | census | censoVisibleMs, censoRecordReadyMs | check:critical-coverage, check:flow-performance-budget, test:e2e:critical:ci | docs/RUNBOOK_OPERATIONAL_BUDGETS.md, docs/RUNBOOK_SUPPORT_OPERATIONS.md |
| handoff | handoff | critical handoff coverage | check:critical-coverage, test:ci:unit | docs/CI_GATES_AND_FAILURE_RUNBOOKS.md |
| backup | backup | backupFilesVisibleMs | check:critical-coverage, check:flow-performance-budget, test:e2e:critical:ci | docs/RUNBOOK_OPERATIONAL_BUDGETS.md, docs/RUNBOOK_SUPPORT_OPERATIONS.md |
| transfers | transfers | critical transfer coverage and finalized transfer flow | check:critical-coverage, test:unit:critical | docs/RUNBOOK_SUPPORT_OPERATIONS.md, docs/CI_GATES_AND_FAILURE_RUNBOOKS.md |
| reminders-admin | admin | administrative reminder critical coverage | check:critical-coverage, test:risk:admin-health | docs/RUNBOOK_SUPPORT_OPERATIONS.md, docs/CI_GATES_AND_FAILURE_RUNBOOKS.md |
| serverless | platform | serverless deploy smoke y bundling de Netlify Functions | check:serverless-runtime-governance, check:netlify-functions-bundle, test:serverless-deploy-smoke | docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md, docs/SERVERLESS_SENSITIVE_CONTRACTS.md |
| ai | ai | respuestas AI configuradas y auth serverless consistente | test:risk:platform, check:serverless-runtime-governance, test:serverless-deploy-smoke | docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md, docs/SERVERLESS_SENSITIVE_CONTRACTS.md |
