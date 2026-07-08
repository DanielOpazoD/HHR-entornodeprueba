# Runbook: recuperación de incidentes del censo diario

**Ámbito:** censo diario, altas, movimientos de cama, CMA, entrega de turno enfermería, entrega
médica y conflictos auto-mergeados.
**Uso:** cuando observabilidad y el estado clínico visible no coinciden, o cuando el centro de
conflictos clínicos no muestra evidencia recuperable.

## Triage inicial

1. Confirmar fecha clínica afectada (`dailyRecord.date`).
2. Identificar el paciente por nombre y RUT/documento.
3. Revisar observabilidad por:
   - `PATIENT_DISCHARGED`
   - `PATIENT_MODIFIED` / `PATIENT_BED_CHANGED`
   - `CONFLICT_AUTO_MERGED`
   - `CONFLICT_VERSION_RESTORED`
4. Comparar estado visible del daily record:
   - `beds[bedId]`
   - `discharges[]`
   - `transfers[]`
   - `cma[]`

## Si el diagnóstico desaparece tras mover cama

1. Revisar el evento de movimiento y confirmar `sourceBed`, `targetBed`, `patientName`,
   `patientRut` y `diagnosis`.
2. Revisar que el paciente en la cama destino conserve `pathology`.
3. Si hubo conflicto posterior, revisar el evento `CONFLICT_AUTO_MERGED`:
   - `sampleDecisions`
   - `changedPaths`
   - `snapshotRecovery`
4. Si el estado visible perdió el diagnóstico, restaurar desde snapshot solo si el panel muestra una
   versión recuperable y la restauración es clínicamente aprobada.

## Si el alta existe en observabilidad pero no aparece en altas del día

1. Confirmar que el evento `PATIENT_DISCHARGED` no es la única fuente de verdad.
2. Buscar la fila esperada en `discharges[]` por:
   - `id`
   - `rut`
   - `patientName`
   - `movementDate`
3. Si falta la fila y hubo conflicto, revisar si el merge descartó un movimiento local nuevo.
4. Reconstruir la fila desde el snapshot `originalData` o desde la versión pre-merge si está
   recuperable.
5. Registrar cualquier restauración o reparación manual como acción auditada.

## Si el centro de conflictos no muestra versiones

El centro aparece como un indicador discreto en censo diario, entrega de enfermería y entrega
médica para usuarios `admin` o `nurse_hospital`. Interpretar el estado:

- **Snapshots recuperables:** existe al menos una versión que puede restaurarse.
- **Snapshots no guardados:** el conflicto ocurrió, pero la captura best-effort falló.
- **Snapshots expirados por TTL:** fueron guardados, pero la ventana de retención temporal expiró.
- **Snapshots sin permiso:** fueron guardados, pero el usuario actual no tiene permiso para leerlos.
- **Snapshots guardados pero no disponibles:** el snapshot fue registrado, pero la lista no pudo
  recuperarse con causa no clasificada.
- **Sin snapshots recuperables:** no hay evidencia operativa disponible en la ventana actual.

En todos los casos, la auditoría permanente debe seguir disponible aunque el snapshot recuperable
haya expirado.

## Si aparece un conflicto auto-mergeado

1. Revisar `CONFLICT_AUTO_MERGED` en observabilidad.
2. Confirmar que `conflictResolutionSummary.lastWriteWins` sea `false`.
3. Revisar `conflictResolutionSummary.mergedPaths` para saber qué intención clínica fue fusionada.
4. Revisar `conflictResolutionSummary.blockedPaths` para saber qué rutas quedaron protegidas.
5. Revisar `conflictResolutionSummary.invariantChecks` antes de decidir restaurar una versión.
6. Si existe `snapshotRecovery.status = saved`, usar el centro de conflictos solo como apoyo
   operativo temporal.
7. Si la regla automática eligió un camino incorrecto, preservar manualmente la versión correcta
   desde el centro. La acción debe quedar como `CONFLICT_VERSION_RESTORED` con `reviewContext`.

## Cuándo restaurar una versión de conflicto

Restaurar solo si se cumplen todas estas condiciones:

- la versión recuperable corresponde al día clínico correcto;
- la restauración corrige una pérdida visible real de alta, traslado, CMA, movimiento interno o
  diagnóstico;
- no revive tombstones ni deja al paciente activo en dos camas;
- el cambio fue revisado por `admin` o `nurse_hospital`;
- la restauración queda auditada como `CONFLICT_VERSION_RESTORED`.

## Cuándo NO restaurar una versión

No restaurar solo porque un snapshot existe. Preferir revisar movimientos e invariantes cuando:

- el conflicto ya fue auto-mergeado y `mergedPaths` contiene el movimiento esperado;
- la ausencia de versiones se explica por TTL expirado;
- hay permiso denegado para el usuario actual y se requiere escalamiento administrativo;
- restaurar una versión vieja borraría altas, traslados, CMA o movimientos aceptados después;
- el problema es una brecha de visualización y el estado persistido ya contiene la fila correcta.

## Validación después de reparar

Ejecutar como mínimo:

```bash
npx vitest run src/tests/services/repositories/dailyRecordCensusIncidentRegression.test.ts \
  src/tests/services/repositories/conflictResolutionMovementDeletionPolicy.test.ts \
  src/tests/services/storage/dailyRecordConflictSnapshotService.test.ts \
  src/tests/views/census/conflictVersionsPresentationController.test.ts \
  src/tests/features/conflicts/clinicalConflictCenterController.test.ts \
  src/tests/features/conflicts/ClinicalConflictCenterControl.test.tsx \
  src/tests/services/repositories/conflictResolutionAuditSummary.test.ts
```

Para cierre de PR:

```bash
npm run typecheck
npm run lint:strict:core
npm run check:daily-record-truth-contract
npm run check:quality:group -- size
npm run check:quality:group -- tests
```
