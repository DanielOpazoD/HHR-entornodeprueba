# Clinical Sync Simulator Contract

**Estado:** vigente.
**Ambito:** censo diario, entrega de turno enfermeria, entrega de turno medica, replay offline y conflictos multi-PC.
**Fuente:** `src/tests/support/clinicalSyncSimulator/`.

## Contrato

El simulador prueba sincronizacion clinica como sistema distribuido liviano. No reemplaza Firestore,
las reglas ni los tests emulator; modela los casos de alto riesgo donde dos navegadores, reinicios,
outbox pendiente y replay stale pueden separar lo que el usuario eligio como cierto de lo que queda
visible en el censo.

La verdad final no es el ultimo navegador que escribio. En este modelo la verdad aceptable es:

1. mutacion aceptada por autoridad o replay;
2. `mutationId`, `clientId`, `tabId`, `expectedVersion` y `changedPaths` presentes;
3. merge por intencion clinica cuando el cambio es compatible;
4. invariantes post-merge antes de publicar el resultado visible;
5. auditoria semantica suficiente para explicar paciente, cama, modulo, resultado y razon.

## Cobertura vigente

| Superficie         | Escenarios cubiertos                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Censo diario       | cliente stale, restart, replay, paciente nuevo en cama vacia, cambio de cama, diagnostico preservado, edicion compatible, conflicto incompatible del mismo campo, replay duplicado por `mutationId`. |
| Movimientos        | altas, traslados y CMA visibles despues de replay stale; cama fuente queda disponible; tombstones/invariantes evitan paciente activo duplicado.                                                      |
| DMI                | edicion compatible de vias/dispositivos con cambios remotos en otros campos; replay stale de DMI no revive dispositivos sobre cama disponible.                                                       |
| Entrega enfermeria | notas dia/noche y novedades preservadas cuando pertenecen al mismo episodio.                                                                                                                         |
| Entrega medica     | notas por especialidad, `medicalHandoffEntries` por `id`, rechazo de entradas stale de otro episodio y consistencia de `medicalHandoffNovedades`.                                                    |
| Aceptacion Rayen   | composicion de ingreso, movimiento, actualizacion, cuna RN, medico tratante y exclusion P-R1/P-R2; una segunda ejecucion identica no produce mutaciones clinicas.                                    |
| Observabilidad     | eventos `queued`, `accepted`, `auto_merged`, `already_applied` y `blocked` con fecha, modulo, paths, mutation/client/tab y resumen de paciente/cama cuando existe.                                   |

## Invariantes que debe hacer fallar el gate

- Un replay no puede borrar alta, traslado, CMA ni movimiento visible previamente aceptado.
- Una cama liberada por alta, traslado o CMA no puede quedar con DMI stale aplicado al paciente anterior.
- Un paciente no puede quedar activo en dos camas despues del merge.
- Un movimiento de cama no puede perder diagnostico, RUT ni `clinicalEpisodeId`.
- Dos clientes stale editando el mismo campo clinico incompatible deben quedar `blocked` o `needs_review`.
- La misma `mutationId` reintentada debe ser `already_applied`, sin duplicar movimientos ni entradas.
- El mismo snapshot Rayen aplicado por segunda vez debe producir cero ingresos, actualizaciones,
  movimientos, egresos, conflictos y pendientes administrativos.
- DMI, notas y handoff medico no pueden cruzar paciente, cama vieja o episodio clinico.

## Brechas deliberadas

- No simula latencia real de red, lease de IndexedDB ni permisos Firestore; eso queda en emulator/e2e.
- No pretende cubrir UI visual ni centro de conflictos clinicos; solo contratos de datos.
- No reimplementa CRDT ni event sourcing; si no puede probar compatibilidad clinica, el comportamiento esperado es bloquear.
- No valida todos los campos de `DailyRecord`; cubre rutas clinicas con historial reciente de incidentes.

## Gate focal esperado

El gate focal debe ejecutarse con:

```bash
npm run test:clinical-sync-simulator
```

El comando debe mantenerse bajo costo y apuntar solo a `src/tests/support/clinicalSyncSimulator`.
Debe formar parte de la validacion local de PRs que toquen sincronizacion clinica, handoff,
movimientos, DMI o conflicto/replay.

## Gate de release

La suite tambien queda promovida como gate visible de CI en `clinical-sync-release-gate`.
Ese job ejecuta el simulador, regenera `reports/sync-convergence.*`, valida el contrato de
evidencia y aplica frescura estricta focal con:

```bash
npm run check:sync-convergence-freshness:strict
```

El artifact `sync-convergence` debe quedar disponible en cada corrida de PR/main para auditar
que la resiliencia clinica distribuida no quedo solamente cubierta de forma implicita por los
shards unitarios.
