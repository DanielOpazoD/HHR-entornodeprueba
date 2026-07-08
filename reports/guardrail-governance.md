# Guardrail Governance

- Version: `1`
- Blocking tiers: `5`
- Report-only guards: `18`
- Quality aggregate checks: `64`

## Blocking Tiers

| Tier | Script | Required Scripts | Purpose |
| --- | --- | --- | --- |
| Inner Loop | `ci:inner-loop` | `typecheck, lint, check:quality, test:unit:critical` | Feedback local rapido sobre tipado, lint, boundaries y riesgos unitarios criticos. |
| Pre Merge | `ci:pre-merge` | `typecheck, lint, check:quality, test:ci:unit` | Verificacion compacta obligatoria antes de merge para tipado, lint, guardrails y suite unitaria/integracion. |
| Merge Gate | `ci:merge-gate` | `ci:pre-merge, lint:strict:core, check:critical-coverage, check:netlify-functions-bundle, build, ci:preview-gate` | Proteccion blocking previa a merge para codigo clinico, auth, storage y bundle, incluyendo chunk graph y smoke de preview del bundle real. |
| Preview Gate | `ci:preview-gate` | `check:bundle-budget, check:chunk-graph, check:runtime-asset-margin, test:e2e:preview:census-bootstrap:built` | Valida budgets, chunk graph aciclico y que el bundle productivo monte correctamente en preview local. |
| Release Gate | `ci:release-gate` | `ci:merge-gate, check:daily-record-authority-release-gate, check:release-evidence, test:firestore:release:ci` | Validacion final con emuladores, reglas Firestore y E2E criticos. |

## Release Confidence

- Script: `test:release-confidence`
- Required scripts: `test:smoke:critical-runtime, test:rules:ci, test:emulator:sync:ci, check:critical-coverage, check:flow-performance-budget, test:e2e:critical:ci`
- Purpose: Pack blocking compacto para release confidence sin duplicar toda la suite unitaria.

## Report-Only Guards

| Id | Script | Artifact |
| --- | --- | --- |
| quality_metrics | `report:quality-metrics` | `reports/quality-metrics.md` |
| operational_health | `report:operational-health` | `reports/operational-health.md` |
| bundle_risk_ledger | `report:bundle-risk-ledger` | `reports/bundle-risk-ledger.md` |
| system_confidence | `report:system-confidence` | `reports/system-confidence.md` |
| compatibility_governance | `report:compatibility-governance` | `reports/compatibility-governance.md` |
| legacy_retirement_debt | `report:legacy-retirement-debt` | `reports/legacy-retirement-debt.md` |
| serverless_sensitive_coverage | `report:serverless-sensitive-coverage` | `reports/serverless-sensitive-coverage.md` |
| compatibility_import_governance | `report:compatibility-import-governance` | `reports/compatibility-import-governance.md` |
| release_readiness | `report:release-readiness-scorecard` | `reports/release-readiness-scorecard.md` |
| release_confidence_matrix | `report:release-confidence-matrix` | `reports/release-confidence-matrix.md` |
| runtime_contracts | `report:runtime-contracts` | `reports/runtime-contracts.md` |
| serverless_runtime_governance | `report:serverless-runtime-governance` | `reports/serverless-runtime-governance.md` |
| guardrail_governance | `report:guardrail-governance` | `reports/guardrail-governance.md` |
| technical_ownership | `report:technical-ownership-map` | `reports/technical-ownership-map.md` |
| sustainable_change_policy | `report:sustainable-change-policy` | `reports/sustainable-change-policy.md` |
| test_runtime_governance | `report:test-runtime-governance` | `reports/test-runtime-governance.md` |
| unit_shard_runtime_profile | `report:unit-shard-runtime-profile` | `reports/unit-shard-runtime-profile.md` |
| ci_runtime_observed_profile | `report:ci-runtime-observed-profile` | `reports/ci-runtime-observed-profile.md` |

## Quality Aggregate

- Script: `check:quality`

| Group | Checks |
| --- | --- |
| boundaries | `check:architecture, check:application-port-boundary, check:legacy-staff-boundary, check:core-test-boundary, check:census-feature-boundary, check:census-export-contract-boundary, check:clinical-documents-feature-boundary, check:handoff-pdf-contract-boundary, check:feature-public-api-boundary, check:lazy-views-feature-entrypoints, check:feature-dependencies, check:shared-layer-boundary, check:barrel-boundaries, check:handoff-context-boundaries, check:storage-context-boundaries, check:core-type-facade-boundaries, check:root-domain-barrels, check:persistence-hub-boundaries, check:legacy-localstorage-imports, check:legacy-bridge-boundary, check:legacy-read-gating, check:folder-dependencies, check:module-dependencies, check:census-runtime-boundary, check:runtime-adapter-boundary, check:native-dialogs, check:firestore-runtime-boundary, check:domain-hotspot-boundary, check:legacy-permissions-boundary` |
| tests | `check:core-trivial-tests, check:test-governance, check:unit-shard-balance, check:ci-runtime-telemetry, check:test-runtime-governance, check:test-failure-catalog, check:flaky-quarantine` |
| hygiene | `check:core-console-usage, check:repo-hygiene` |
| governance-inputs | `report:legacy-bridge, report:compatibility-governance` |
| governance | `check:legacy-retirement-debt, check:compatibility-import-governance, check:schema-governance, check:runtime-contracts, check:sync-invariants, check:serverless-runtime-governance, check:serverless-sensitive-coverage, check:docs-drift, check:operational-runbooks, check:firestore-emulator-governance, check:ci-artifact-contracts, check:guardrail-governance` |
| size | `check:module-size, check:handoff-module-size, check:census-module-size, check:transfers-module-size, check:hook-hotspots, check:hotspot-growth, check:bundle-risk-ledger` |
| reports | `check:report-freshness` |
| type-safety | `check:critical-any, check:source-any` |
| security | `check:clinical-mutation-audit-policy, check:security` |

## Governance Policy

- Creation: Todo guardrail nuevo nace como report-only salvo que proteja un riesgo ya materializado.
- Promotion: Un guardrail se vuelve blocking solo si existe owner, baseline y runbook de falla.
- Retirement: Un guardrail puede retirarse solo si otro gate cubre explicitamente el mismo riesgo.

