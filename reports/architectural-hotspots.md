# Architectural Hotspots

- Generated: 2026-05-24T04:18:42.953Z
- Ranking formula: `churn*2 + inboundImports*3 + criticalityWeight*5`

## Interpretation

- Score alto = alto costo de cambio probable.
- Priorizar score alto con acción `reduce-responsibility` o `protect-boundary`.
- Contratos estables y barrels pequeños son superficies sanas: proteger API antes que fragmentar.
- Cruzar este reporte con compatibilidad legacy y cobertura crítica antes de priorizar trabajo.

## Top Hotspots

| File | Lines | Churn | Inbound imports | Criticality | Role | Action | Score |
| --- | ---: | ---: | ---: | --- | --- | --- | ---: |
| `src/application/shared/dailyRecordCoreContracts.ts` | 17 | 2 | 79 | high | contract | protect-api | 261 |
| `src/services/utils/loggerScope.ts` | 13 | 2 | 74 | high | implementation | protect-boundary | 246 |
| `src/shared/contracts/applicationOutcomeTypes.ts` | 59 | 2 | 70 | medium | contract | protect-api | 229 |
| `src/features/clinical-documents/domain/entities.ts` | 6 | 13 | 55 | high | barrel | watch-only | 211 |
| `src/features/census/components/patient-row/patientRowContracts.ts` | 47 | 17 | 52 | high | contract | protect-boundary | 210 |
| `src/context/AuthContext.tsx` | 121 | 17 | 49 | medium | orchestrator | protect-boundary | 196 |
| `src/types/domain/dailyRecord.ts` | 91 | 8 | 50 | medium | contract | protect-boundary | 181 |
| `src/types/authRoleTypes.ts` | 19 | 1 | 52 | medium | contract | protect-api | 173 |
| `src/components/shared/BaseModal.tsx` | 39 | 11 | 45 | medium | implementation | protect-boundary | 172 |
| `src/context/UIContext.tsx` | 144 | 8 | 42 | medium | orchestrator | protect-boundary | 157 |
| `src/shared/contracts/applicationOutcomeFactories.ts` | 66 | 2 | 45 | medium | contract | protect-api | 154 |
| `src/types/domain/patient.ts` | 133 | 9 | 39 | medium | contract | protect-boundary | 150 |
| `src/services/observability/operationalTelemetryOutcomeRecorder.ts` | 132 | 4 | 40 | high | implementation | protect-boundary | 148 |
| `src/types/auditLogTypes.ts` | 71 | 2 | 43 | medium | contract | protect-api | 148 |
| `src/features/census/types/censusAccessProfile.ts` | 5 | 2 | 39 | high | contract | protect-api | 141 |
| `src/services/observability/operationalTelemetryRecorder.ts` | 68 | 2 | 39 | high | implementation | protect-boundary | 141 |
| `src/services/repositories/repositoryConfig.ts` | 195 | 11 | 32 | high | implementation | protect-boundary | 138 |
| `src/utils/clinicalDayUtils.ts` | 18 | 7 | 34 | medium | implementation | protect-boundary | 131 |
| `src/services/storage/indexeddb/indexedDbCore.ts` | 168 | 34 | 14 | high | implementation | reduce-responsibility | 130 |
| `src/constants/clinicalMovementConstants.ts` | 49 | 1 | 37 | medium | implementation | protect-boundary | 128 |
| `src/types/auditActionTypes.ts` | 54 | 5 | 34 | medium | contract | protect-boundary | 127 |
| `src/constants/beds.ts` | 44 | 4 | 34 | medium | implementation | protect-boundary | 125 |
| `src/context/DailyRecordContext.tsx` | 171 | 16 | 25 | medium | orchestrator | watch | 122 |
| `src/constants/firestorePaths.ts` | 155 | 7 | 30 | medium | implementation | protect-boundary | 119 |
| `src/types/transferRequestTypes.ts` | 91 | 1 | 34 | medium | contract | protect-api | 119 |
| `src/hooks/contracts/patientHookContracts.ts` | 8 | 3 | 32 | medium | contract | protect-api | 117 |
| `src/features/census/contracts/censusMovementContracts.ts` | 14 | 1 | 31 | high | contract | protect-api | 115 |
| `src/shared/runtime/browserWindowRuntimeCore.ts` | 87 | 2 | 32 | medium | implementation | protect-boundary | 115 |
| `src/services/repositories/dailyRecordRepositoryWriteService.ts` | 347 | 41 | 4 | high | implementation | reduce-responsibility | 114 |
| `src/types/domain/labExamTypes.ts` | 52 | 1 | 32 | medium | contract | protect-api | 113 |

