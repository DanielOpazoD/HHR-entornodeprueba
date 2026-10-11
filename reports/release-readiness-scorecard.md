# Release Readiness Scorecard

Generated at: 2026-10-07T06:20:24.295Z
Commit: f4ba275c
Worktree: dirty
Overall: degraded

## Indicators

- `worktree_state`: degraded (status=dirty)
- `structural_quality`: ok (oversized=0, folderDebt=0, sourceAny=0)
- `system_confidence`: ok (overall=ok, openKnownFailures=0)
- `operational_readiness`: ok (flow=passing, bundle=ok)
- `frontend_startup`: ok (status=ok, preview=ok, issues=0)
- `release_hotspots`: ok (vendor-heic2any-ClJ2fQYX.js: 1320.4 KB / 1416.0 KB (near-limit) | app-authenticated-shell-db-S1lVy.js: 614.1 KB / 615.2 KB (near-limit) | vendor-pdfjs-DTBrk9zO.js: 449.7 KB / 507.8 KB (near-limit) | vendor-firebase-firestore-Bq9EckP1.js: 388.3 KB / 488.3 KB (ok) | vendor-pdf-lib-COR8hm7M.js: 381.7 KB / 419.9 KB (near-limit))
- `bundle_risk_ledger`: ok (surfaces=7, issues=0)
- `release_confidence`: ok (areas=11, blockingMapped=7/7)
- `ownership_governance`: ok (areas=11)
- `guardrail_governance`: ok (blockingTiers=5, reportOnly=18)
- `compatibility_governance`: ok (restrictedEntries=0, unauthorizedImports=0)
- `legacy_retirement_debt`: ok (openSurfaces=4/4, issues=0)

## Sources

- `qualityMetrics`: reports/quality-metrics.json (2026-07-05T06:20:03.273Z)
- `bundleRiskLedger`: reports/bundle-risk-ledger.json (stable:bundle-risk-ledger)
- `systemConfidence`: reports/system-confidence.json (2026-07-05T06:20:05.363Z)
- `operationalHealth`: reports/operational-health.json (2026-07-05T06:20:04.606Z)
- `releaseConfidenceMatrix`: reports/release-confidence-matrix.json (2026-07-05T06:20:05.119Z)
- `technicalOwnershipMap`: reports/technical-ownership-map.json (2026-07-05T06:17:55.749Z)
- `guardrailGovernance`: reports/guardrail-governance.json (2026-07-06T05:44:53.924Z)
- `compatibilityImportGovernance`: reports/compatibility-import-governance.json (2026-07-05T06:02:31.571Z)
- `legacyRetirementDebt`: reports/legacy-retirement-debt.json (stable:legacy-retirement-debt)

## Advisory

- Overall remains `degraded` only because the snapshot was generated with a dirty worktree.
- Readiness indicators sourced from reports remain technically `ok`.

## Issues

- worktree_state: status=dirty

## Release Hotspots

- vendor-heic2any-ClJ2fQYX.js: 1320.4 KB / 1416.0 KB (near-limit)
- app-authenticated-shell-db-S1lVy.js: 614.1 KB / 615.2 KB (near-limit)
- vendor-pdfjs-DTBrk9zO.js: 449.7 KB / 507.8 KB (near-limit)
- vendor-firebase-firestore-Bq9EckP1.js: 388.3 KB / 488.3 KB (ok)
- vendor-pdf-lib-COR8hm7M.js: 381.7 KB / 419.9 KB (near-limit)
