# Test Megatest Backlog

Última actualización: 2026-04-10

Este registro conserva las particiones históricas. El límite de 500 líneas y su backlog
de excepciones se retiraron; las nuevas particiones requieren fricción de mantenimiento observada.

## Objetivo

Identificar tests grandes con mayor costo de mantenimiento para partirlos sin perder cobertura útil.

## Particiones realizadas

- `src/tests/features/clinical-documents/ClinicalDocumentsWorkspace.test.tsx`
  ahora se reparte entre `ClinicalDocumentsWorkspace.test.tsx` y `ClinicalDocumentsWorkspace.behavior.test.tsx`.
- `src/tests/hooks/useBedManagement.test.ts`
  ahora se reparte entre `useBedManagement.patient-updates.test.ts` y `useBedManagement.operations.test.ts`.
- `src/tests/views/census/PatientRowOrbitalQuickActions.test.tsx`
  ahora se reparte entre `PatientRowOrbitalQuickActions.behavior.test.tsx` y `PatientRowOrbitalQuickActions.visibility.test.tsx`.
- `src/tests/services/transfers/transferService.test.ts`
  ahora se reparte entre `transferService.mutations.test.ts` y `transferService.queries.test.ts`.
- `src/tests/services/repositories/DailyRecordRepository.test.ts`
  ahora se reparte entre `DailyRecordRepository.reads.test.ts` y `DailyRecordRepository.lifecycle.test.ts`.
- `src/tests/services/calculations/minsalStatsCalculator.test.ts`
  ahora se reparte entre `minsalStatsCalculator.ranges-and-snapshots.test.ts`,
  `minsalStatsCalculator.aggregate-stats.test.ts` y `minsalStatsCalculator.stay-resolution.test.ts`.
- `src/tests/security/firestore-rules.test.ts`
  ahora se reduce a un entrypoint con harness común y grupos separados en
  `firestoreRulesAccessGroups.ts`, `firestoreRulesDomainGroups.ts` y
  `firestoreRulesIdentityGroups.ts`.
- `src/tests/hooks/useDailyRecord.test.tsx`
  ahora se reparte entre `useDailyRecord.lifecycle.test.tsx` y
  `useDailyRecord.validation-guards.test.tsx`.
- `src/tests/views/census/CensusActionsContext.test.tsx`
  ahora se reparte entre `CensusActionsContext.state-and-contract.test.tsx` y
  `CensusActionsContext.execution-and-feedback.test.tsx`.
- `src/tests/hooks/useTransferViewStates.test.ts`
  ahora se reparte entre `useTransferViewStates.modal-state.test.ts` y
  `useTransferViewStates.document-package.test.ts`.
- `src/tests/views/census/CensusTable.test.tsx`
  ahora se reparte entre `CensusTable.layout-and-actions.test.tsx` y
  `CensusTable.clinical-indicators.test.tsx`.
- `src/tests/features/transfers/TransferManagementView.test.tsx`
  ahora se reparte entre `TransferManagementView.grouping.test.tsx` y
  `TransferManagementView.notes-inline.test.tsx`.
- `src/tests/components/PatientRow.test.tsx`
  ahora se reparte entre `PatientRow.layout-and-actions.test.tsx` y
  `PatientRow.crib-and-demographics.test.tsx`.
- `src/tests/hooks/useHandoffLogic.test.ts`
  ahora se reparte entre `useHandoffLogic.nursing-and-events.test.ts`,
  `useHandoffLogic.medical-handoff.test.ts` y `useHandoffLogic.test-support.ts`.
- `src/tests/schemas/zodSchemas.test.ts`
  ahora se reparte entre `zodEntitySchemas.test.ts` y `zodDailyRecordSchemas.test.ts`.
- `src/tests/services/repositories/DailyRecordRepository.lifecycle.test.ts`
  ahora se reparte entre `DailyRecordRepository.persistence-and-copy.test.ts`,
  `DailyRecordRepository.initialization-and-bootstrap.test.ts` y `DailyRecordRepository.lifecycle-support.ts`.

## Criterio de priorización

- tamaño del archivo;
- mezcla de responsabilidades en un solo spec;
- cercanía a runtime crítico o lógica clínica;
- probabilidad de ruido al cambiar código no relacionado.

## Candidatos prioritarios

| Prioridad | Archivo | Líneas | Riesgo dominante | Estrategia de partición |
| --------- | ------- | -----: | ---------------- | ----------------------- |

No hay particiones prioritarias pendientes en este registro histórico.

## Segunda ola sugerida

- `src/tests/integration/daily-record-sync.test.tsx`
- `src/tests/integration/census-export.test.ts`
- `src/tests/views/handoff/HandoffRow.test.tsx`
- `src/tests/hooks/useHandoffManagement.test.ts`
- `src/tests/services/repositories/dailyRecordRepositoryWriteService.test.ts`

## Reglas de ejecución

- No partir por tamaño solamente; empezar por los `P1`.
- Mantener tests de integración donde agreguen señal real.
- Si una suite se parte, conservar nombres orientados a seams concretos y no a “part 1 / part 2”.
- Cada partición debe dejar el archivo original más pequeño o retirarlo completamente.

## Siguiente acción recomendada

1. Medir el tiempo de diagnóstico y costo de cambio antes de proponer otra partición.
2. Mantener futuras particiones orientadas a seams concretos y no a tamaño por sí solo.
3. Revisar la segunda ola solo cuando reaparezca fricción real de edición o lectura.
