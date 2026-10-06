# Folder Dependency Debt Report

Generated at: 2026-10-06T18:37:58.144Z

Current violations: **9**

## Violations by Zone Pair

| Zone Pair         | Count |
| ----------------- | ----: |
| hooks -> features |     9 |

## Top Importer Files

| File                                                            | Violations |
| --------------------------------------------------------------- | ---------: |
| `src/hooks/controllers/clinicalShiftCalendarController.ts`      |          1 |
| `src/hooks/controllers/dischargeModalController.ts`             |          1 |
| `src/hooks/controllers/modalFormController.ts`                  |          1 |
| `src/hooks/controllers/moveCopyModalController.ts`              |          1 |
| `src/hooks/controllers/patientMovementUndoController.ts`        |          1 |
| `src/hooks/controllers/sharedCensusBrowserRuntimeController.ts` |          1 |
| `src/hooks/controllers/sharedCensusFilesController.ts`          |          1 |
| `src/hooks/controllers/sharedCensusModeController.ts`           |          1 |
| `src/hooks/controllers/transferModalController.ts`              |          1 |

## Full Violation List

- `src/hooks/controllers/clinicalShiftCalendarController.ts` (hooks) -> `@/features/census/controllers/clinicalShiftCalendarController` => `src/features/census/controllers/clinicalShiftCalendarController.ts` (features)
- `src/hooks/controllers/dischargeModalController.ts` (hooks) -> `@/features/census/controllers/dischargeModalController` => `src/features/census/controllers/dischargeModalController.ts` (features)
- `src/hooks/controllers/modalFormController.ts` (hooks) -> `@/features/census/controllers/modalFormController` => `src/features/census/controllers/modalFormController.ts` (features)
- `src/hooks/controllers/moveCopyModalController.ts` (hooks) -> `@/features/census/controllers/moveCopyModalController` => `src/features/census/controllers/moveCopyModalController.ts` (features)
- `src/hooks/controllers/patientMovementUndoController.ts` (hooks) -> `@/features/census/controllers/patientMovementUndoController` => `src/features/census/controllers/patientMovementUndoController.ts` (features)
- `src/hooks/controllers/sharedCensusBrowserRuntimeController.ts` (hooks) -> `@/features/census/controllers/sharedCensusBrowserRuntimeController` => `src/features/census/controllers/sharedCensusBrowserRuntimeController.ts` (features)
- `src/hooks/controllers/sharedCensusFilesController.ts` (hooks) -> `@/features/census/controllers/sharedCensusFilesController` => `src/features/census/controllers/sharedCensusFilesController.ts` (features)
- `src/hooks/controllers/sharedCensusModeController.ts` (hooks) -> `@/features/census/controllers/sharedCensusModeController` => `src/features/census/controllers/sharedCensusModeController.ts` (features)
- `src/hooks/controllers/transferModalController.ts` (hooks) -> `@/features/census/controllers/transferModalController` => `src/features/census/controllers/transferModalController.ts` (features)
