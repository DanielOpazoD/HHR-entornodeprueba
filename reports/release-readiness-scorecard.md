# Release Readiness Scorecard

Generated at: 2026-10-19T05:26:41.964Z
Commit: abb0f5a2
Worktree: dirty
Overall: degraded

## Indicators

- `worktree_state`: degraded (status=dirty)
- `structural_quality`: ok (oversized=0, folderDebt=0, sourceAny=0)
- `system_confidence`: ok (overall=ok, openKnownFailures=0)
- `operational_readiness`: ok (flow=passing, bundle=ok)
- `frontend_startup`: ok (status=ok, preview=ok, issues=0)
- `release_hotspots`: ok (vendor-heic2any-BjDsP1gW.js: 1320.4 KB / 1416.0 KB (near-limit) | vendor-dicom-vtk-B8akqPS2.js: 1053.2 KB / 1220.7 KB (near-limit) | app-authenticated-shell-OBcmwlhV.js: 615.2 KB / 615.2 KB (near-limit) | vendor-pdfjs-BGyLORnz.js: 449.7 KB / 507.8 KB (near-limit) | vendor-firebase-firestore-Bq9EckP1.js: 388.3 KB / 488.3 KB (ok))
- `bundle_risk_ledger`: ok (surfaces=8, issues=0)
- `release_confidence`: ok (areas=11, blockingMapped=7/7)
- `ownership_governance`: ok (areas=11)
- `guardrail_governance`: ok (blockingTiers=5, reportOnly=18)
- `compatibility_governance`: ok (restrictedEntries=0, unauthorizedImports=0)
- `legacy_retirement_debt`: ok (openSurfaces=4/4, issues=0)

## Sources

- `qualityMetrics`: reports/quality-metrics.json (2026-10-18T03:03:18.157Z)
- `bundleRiskLedger`: reports/bundle-risk-ledger.json (stable:bundle-risk-ledger)
- `systemConfidence`: reports/system-confidence.json (2026-10-18T03:06:48.471Z)
- `operationalHealth`: reports/operational-health.json (2026-10-18T03:06:48.268Z)
- `releaseConfidenceMatrix`: reports/release-confidence-matrix.json (2026-10-18T03:06:48.665Z)
- `technicalOwnershipMap`: reports/technical-ownership-map.json (2026-10-18T03:06:48.791Z)
- `guardrailGovernance`: reports/guardrail-governance.json (2026-10-18T03:06:48.900Z)
- `compatibilityImportGovernance`: reports/compatibility-import-governance.json (2026-10-18T03:03:21.222Z)
- `legacyRetirementDebt`: reports/legacy-retirement-debt.json (stable:legacy-retirement-debt)

## Advisory

- Overall remains `degraded` only because the snapshot was generated with a dirty worktree.
- Readiness indicators sourced from reports remain technically `ok`.

## Issues

- worktree_state: status=dirty

## Release Hotspots

- vendor-heic2any-BjDsP1gW.js: 1320.4 KB / 1416.0 KB (near-limit)
- vendor-dicom-vtk-B8akqPS2.js: 1053.2 KB / 1220.7 KB (near-limit)
- app-authenticated-shell-OBcmwlhV.js: 615.2 KB / 615.2 KB (near-limit)
- vendor-pdfjs-BGyLORnz.js: 449.7 KB / 507.8 KB (near-limit)
- vendor-firebase-firestore-Bq9EckP1.js: 388.3 KB / 488.3 KB (ok)
