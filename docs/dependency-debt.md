# Folder Dependency Debt Report

Generated at: 2026-10-06T22:34:44.510Z

Current violations: **6**

## Violations by Zone Pair

| Zone Pair         | Count |
| ----------------- | ----: |
| hooks -> features |     6 |

## Top Importer Files

| File                                                            | Violations |
| --------------------------------------------------------------- | ---------: |
| `src/hooks/controllers/clinicalShiftCalendarController.ts`      |          1 |
| `src/hooks/controllers/modalFormController.ts`                  |          1 |
| `src/hooks/controllers/moveCopyModalController.ts`              |          1 |
| `src/hooks/controllers/sharedCensusBrowserRuntimeController.ts` |          1 |
| `src/hooks/controllers/sharedCensusFilesController.ts`          |          1 |
| `src/hooks/controllers/sharedCensusModeController.ts`           |          1 |

## Full Violation List

- `src/hooks/controllers/clinicalShiftCalendarController.ts` (hooks) -> `@/features/census/controllers/clinicalShiftCalendarController` => `src/features/census/controllers/clinicalShiftCalendarController.ts` (features)
- `src/hooks/controllers/modalFormController.ts` (hooks) -> `@/features/census/controllers/modalFormController` => `src/features/census/controllers/modalFormController.ts` (features)
- `src/hooks/controllers/moveCopyModalController.ts` (hooks) -> `@/features/census/controllers/moveCopyModalController` => `src/features/census/controllers/moveCopyModalController.ts` (features)
- `src/hooks/controllers/sharedCensusBrowserRuntimeController.ts` (hooks) -> `@/features/census/controllers/sharedCensusBrowserRuntimeController` => `src/features/census/controllers/sharedCensusBrowserRuntimeController.ts` (features)
- `src/hooks/controllers/sharedCensusFilesController.ts` (hooks) -> `@/features/census/controllers/sharedCensusFilesController` => `src/features/census/controllers/sharedCensusFilesController.ts` (features)
- `src/hooks/controllers/sharedCensusModeController.ts` (hooks) -> `@/features/census/controllers/sharedCensusModeController` => `src/features/census/controllers/sharedCensusModeController.ts` (features)
