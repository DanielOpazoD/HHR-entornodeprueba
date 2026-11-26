# Clinical Legal Audit Exports And Timeline Plan

## Scope

Implement the second audit block on top of `main` after PR #104.

## Steps

1. Add failing tests for clinical export rows, PDF, Excel, timeline grouping, and semantic narratives.
2. Add a pure `clinicalAuditExportRows` mapper that consumes `buildClinicalAuditPresentation`.
3. Update `auditWorkbook` to write clinical/legal columns.
4. Update `auditPdfUtils` to render clinical/legal HTML with escaped values.
5. Add a pure `clinicalAuditTimeline` controller for grouping logs by patient/record subject.
6. Update `AuditTimeline` to render the clinical timeline.
7. Expand `clinicalAuditPresentation` known narratives for common action families.
8. Run focused tests, typecheck, lint, build, and check:quality.
9. Commit, push, create PR, and wait for CI green.
