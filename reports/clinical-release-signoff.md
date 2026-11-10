# Clinical Release Signoff

Generated at: 2026-07-05T06:20:04.876Z
Commit: 126d4b82
Worktree: clean
Release candidate: codex/release-readiness-blocks
Overall: ok

| Scenario | Status | Validated by | Validated at | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| census_reload_remote_reconcile | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#census_reload_remote_reconcile<br>visual_e2e: reports/e2e/clinical-visual-release-report.json | Approved after localhost clinical release walkthrough. |
| pending_patch_patient_movement | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#pending_patch_patient_movement<br>automated_regression: src/tests/hooks/controllers/dailyRecordPendingPatchController.test.ts | Approved after localhost clinical release walkthrough. |
| clinical_documents_pdf_print | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#clinical_documents_pdf_print<br>visual_e2e: reports/e2e/clinical-visual-release-report.json | Approved after localhost clinical release walkthrough. |
| handoff_shift_export | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#handoff_shift_export<br>visual_e2e: reports/e2e/clinical-visual-release-report.json | Approved after localhost clinical release walkthrough. |
| external_clinical_dependencies | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#external_clinical_dependencies<br>automated_regression: npm run test:risk:platform | Approved after localhost clinical release walkthrough. |
| backup_restore_export | passed | Dr. Nombre Apellido / Daniel / Equipo clínico HHR | 2026-05-16T19:07:20Z | manual_signoff: docs/runbooks/clinical-release-signoff-2026-05-16.md#backup_restore_export<br>automated_regression: npm run test:platform-resilience | Approved after localhost clinical release walkthrough. |
