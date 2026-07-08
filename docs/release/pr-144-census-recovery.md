# PR #144: evidencia de recuperación estructural del censo diario

**PR:** <https://github.com/DanielOpazoD/HHR-ServicioHospitalizados/pull/144>
**Branch:** `codex/census-daily-stability-recovery`
**Fecha clínica de referencia:** 2026-07-01
**Estado:** evidencia de PR, no reporte generado.

## Incidentes cubiertos

1. Traslado de cama podía hacer que el diagnóstico pareciera desaparecer.
   - Caso reportado: Pierre-jean, documento `25DF52626`.
2. Alta registrada en observabilidad podía no aparecer en altas del día.
   - Caso reportado: Bernardo Orrego Llanos, RUT `17.274.300-5`.
3. Conflicto auto-resuelto podía quedar visible en observabilidad, pero sin explicación suficiente ni
   versiones recuperables claras en el panel del censo.

## Cambios estructurales

| Bloque      | Cambio                                                              | Evidencia                                                                    |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Movimientos | Merge por `id` y preservación de movimientos locales nuevos.        | `conflictResolutionMovementMergePolicy.ts`                                   |
| Tombstones  | `deletedAt` domina sobre copia viva del mismo movimiento.           | `conflictResolutionMovementDeletionPolicy.test.ts`                           |
| Alta        | Payload canónico de auditoría y fila persistente en `discharges[]`. | `dischargeCanonicalAdoptionController.ts`, `auditClinicalEventCatalog.ts`    |
| Conflicto   | Snapshots pre-merge, TTL y detalle de decisiones.                   | `dailyRecordConflictSnapshotService.ts`, `conflictResolutionAuditSummary.ts` |
| UI admin    | Estado explícito cuando no hay snapshots recuperables.              | `conflictVersionsPresentationController.ts`                                  |
| Evidencia   | ADR, runbook y test integrado de incidente.                         | Este documento, `ADR_DAILY_CENSUS_MOVEMENT_CONFLICT_INVARIANTS.md`           |

## Validación local esperada

```bash
npx vitest run \
  src/tests/services/repositories/dailyRecordCensusIncidentRegression.test.ts \
  src/tests/services/repositories/conflictResolutionMatrix.censusMovements.test.ts \
  src/tests/services/repositories/conflictResolutionMovementDeletionPolicy.test.ts \
  src/tests/services/repositories/conflictResolutionAuditSummary.test.ts \
  src/tests/services/storage/dailyRecordConflictSnapshotService.test.ts \
  src/tests/views/census/conflictVersionsPresentationController.test.ts \
  src/tests/services/admin/auditClinicalEventCatalog.test.ts \
  src/tests/hooks/controllers/bedOperationsAuditController.test.ts
```

```bash
npm run typecheck
npm run lint:strict:core
npm run check:quality:group -- size
npm run check:quality:group -- tests
VITE_DAILY_RECORD_AUTHORITY_MODE=enforced npm run check:daily-record-authority-release-gate
```

## Criterio de merge

- CI completo en verde.
- PR fuera de draft solo después de revisar comentarios automáticos reales.
- No agregar un editor de diff ni un replayer de auditoría en este PR; eso sería más grande que el
  problema actual.
