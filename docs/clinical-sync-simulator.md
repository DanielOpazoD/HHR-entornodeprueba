# Clinical Sync Simulator

## Objetivo

El simulador prueba sincronizacion clinica como un sistema distribuido pequeno y determinista:
dos o mas clientes logicos, estado remoto compartido, estado local stale, outbox pendiente,
reinicio logico y replay contra el contrato real de merge.

La verdad final no es "ultimo navegador que escribio". La verdad final es:

1. mutacion aceptada por autoridad;
2. merge por intencion clinica;
3. invariantes post-merge;
4. trazabilidad suficiente para entender el resultado;
5. conflicto revisable o bloqueado cuando la convergencia automatica no es segura.

## Ubicacion

- Harness: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts`
- Contrato base: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts`
- Censo diario: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts`
- Entrega de turno: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.handoff.test.ts`

## Como correrlo

```bash
npx vitest run src/tests/support/clinicalSyncSimulator
```

El simulador tambien queda registrado en la evidencia formal de convergencia:

```bash
npm run check:sync-convergence-evidence
npm run report:sync-convergence
npm run check:sync-convergence-freshness:strict
```

En CI se ejecuta como job dedicado `clinical-sync-release-gate` y sube el artifact
`sync-convergence` con `reports/sync-convergence.*`. Ese job hace visible la garantia de
sincronizacion clinica distribuida aunque los mismos tests tambien puedan entrar por shards
unitarios generales.

## Que cubre

- Clientes logicos independientes con `clientId`, `tabId`, `mutationId`, `expectedVersion`
  y `changedPaths`.
- Outbox stale que sobrevive a reinicio logico.
- Replay con `resolveDailyRecordConflictWithTrace`.
- Invariantes post-merge con `evaluateDailyRecordConflictPostMergeInvariants`.
- Eventos auditables compactos con fecha, modulo, cliente, tab, mutacion y resultado.
- Resumen clinico auditable por cama/paciente/RUT cuando el cambio apunta a una cama.
- Frontera explicita entre auto-merge seguro y conflicto revisable: el mismo campo clinico
  editado desde dos clientes stale queda bloqueado.
- Idempotencia de replay: reintentar la misma `mutationId` termina como `already_applied`.
- Censo diario:
  - crear paciente en cama disponible mientras otro cliente esta stale;
  - editar diagnostico/estado/especialidad en replay compatible;
  - mover paciente de cama preservando RUT, diagnostico y episodio;
  - alta, traslado y CMA visibles, con cama liberada;
  - DMI replay stale sin residuos en cama egresada.
- Entrega enfermeria:
  - `handoffNoteDayShift`;
  - `handoffNoteNightShift`;
  - `handoffNovedadesDayShift`;
  - `handoffNovedadesNightShift`.
- Entrega medica:
  - `medicalHandoffBySpecialty` en especialidades paralelas;
  - `medicalHandoffEntries` concurrentes por `id`;
  - entrada stale de otro episodio no revive.

## Que no cubre

- No controla navegador real ni IndexedDB real.
- No reemplaza tests emulator ni e2e.
- No valida reglas Firestore.
- No rediseña UI ni centro de conflictos.
- No introduce server-side indexing.

## Interpretacion de resultados

- `accepted`: el cliente escribio contra la version esperada.
- `auto_merged`: el cliente estaba stale, pero la intencion clinica pudo converger sin violar
  invariantes.
- `blocked`: el merge propuesto viola una invariante post-merge y no debe publicarse.
- `already_applied`: la mutacion ya estaba aplicada o no queda outbox pendiente.

Si un caso falla, se debe revisar primero si el test expresa una verdad clinica esperada. Si la
respuesta es si, el fix debe ir en merge/invariantes/consistencia, no en el harness.
