# Folder Dependency Debt Report

Generated at: 2026-10-06T23:18:35.881Z

Current violations: **3**

## Violations by Zone Pair

| Zone Pair         | Count |
| ----------------- | ----: |
| hooks -> features |     3 |

## Top Importer Files

| File                                                       | Violations |
| ---------------------------------------------------------- | ---------: |
| `src/hooks/controllers/clinicalShiftCalendarController.ts` |          1 |
| `src/hooks/controllers/modalFormController.ts`             |          1 |
| `src/hooks/controllers/moveCopyModalController.ts`         |          1 |

## Full Violation List

- `src/hooks/controllers/clinicalShiftCalendarController.ts` (hooks) -> `@/features/census/controllers/clinicalShiftCalendarController` => `src/features/census/controllers/clinicalShiftCalendarController.ts` (features)
- `src/hooks/controllers/modalFormController.ts` (hooks) -> `@/features/census/controllers/modalFormController` => `src/features/census/controllers/modalFormController.ts` (features)
- `src/hooks/controllers/moveCopyModalController.ts` (hooks) -> `@/features/census/controllers/moveCopyModalController` => `src/features/census/controllers/moveCopyModalController.ts` (features)
