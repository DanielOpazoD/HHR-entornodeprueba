# Quality Metrics Snapshot

Generated at: 2026-11-10T15:35:14.457Z
Commit: 6b9530fa8

## Source

- Files: 2969
- Lines: 341169

## Module Size

- Global line limit: 600
- Allowlist hotspots: 0
- Oversized modules: 0

## Folder Dependency Debt

- Violations: 0

## Tests

- Test files: 2723
- Forbidden .skip markers: 0
- Forbidden .only markers: 0
- Flake-risk test files: 36
  - src/tests/components/ExamRequestModal.integration.test.tsx
  - src/tests/components/ExamRequestSignature.test.tsx
  - src/tests/components/modals/mmradStudySearch.test.ts
  - src/tests/components/radiologyExamListMemory.test.ts
  - src/tests/emulator/sharedComputerAuthority.emulator.test.ts
  - src/tests/emulator-ui/dailyRecordServerConfirmation.emulator-ui.test.ts
  - src/tests/features/admin/AuditView.test.tsx
  - src/tests/features/census/StaffShiftDetailsModal.test.tsx
  - src/tests/functions/mmradDicomSantiagoFunction.test.ts
  - src/tests/hooks/staffingWriteRejections.test.tsx
  - src/tests/hooks/useDailyRecordFreshnessGate.test.tsx
  - src/tests/hooks/useDailyRecordQuery.test.tsx
  - src/tests/hooks/useMinsalStats.test.tsx
  - src/tests/hooks/useSessionPermissionGuard.test.ts
  - src/tests/netlify/mmradCheckDigitSearch.test.ts
  - src/tests/rayen-import/DailyRecordTaskRecovery.test.tsx
  - src/tests/rayen-import/RayenImportButton.bootstrap.test.tsx
  - src/tests/rayen-import/gestionCamasVerificationPersistenceExtension.test.ts
  - src/tests/rayen-import/rayenImportPolicyServerConfirmation.test.ts
  - src/tests/scripts/checkClinicalClock.test.ts
  - src/tests/services/auth/nursingAccountRole.test.ts
  - src/tests/services/auth/nursingAccountSession.test.ts
  - src/tests/services/repositories/dailyRecordStaleBasePendingProjection.test.ts
  - src/tests/services/storage/dailyRecordTaskRetirement.test.ts
  - src/tests/services/storage/sessionLogoutQueueFencing.test.ts
  - src/tests/services/storage/sessionLogoutRetainedDayWork.test.ts
  - src/tests/services/storage/sharedComputerRetainedState.test.ts
  - src/tests/services/storage/specialistHandoffComposedOutbox.test.tsx
  - src/tests/services/storage/syncQueueBaseReview.test.ts
  - src/tests/services/storage/syncQueueFailureContext.test.ts
  - src/tests/services/storage/syncQueueFunctionsRecovery.test.ts
  - src/tests/views/census/clinical-explorer/ClinicalExplorerImaging.test.tsx
  - src/tests/views/census/clinical-explorer/ClinicalExplorerLab.test.tsx
  - src/tests/views/census/clinical-explorer/clinicalExplorerStore.test.tsx
  - src/tests/views/census/exam-orders/CensusExamOrderSelection.test.tsx
  - src/tests/views/cudyr/CudyrExplorerLoading.test.tsx
- Megatests >500 lines: 0

## Type Safety Signals

- Explicit any occurrences (total): 48
- Explicit any in source (non-test): 0
- Explicit any in tests: 48

## Convergence Signals

- Accidental copy files in src: 0
- Governed compatibility shims in source: 3
- Feature public API boundary violations: 0
- Deprecated shim imports in source: 0
- DailyRecord root-boundary violations in source: 0
- Census controller ownership drift: 0
- Raw console warn/error outside structured sink: 1

## Release Confidence Governance

- Overall: ok
- Areas: 11
- Coverage zones mapped: 16/16
- Blocking steps mapped: 8/8
- Smoke scenarios mapped: 6/6
- Flow budgets mapped: 7/7
