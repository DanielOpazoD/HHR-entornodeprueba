# Runbook Operativo: Sync y Resiliencia

## Objetivo

Guía rápida para soporte ante incidentes de datos/sincronización:

- IndexedDB bloqueado (modo degradado).
- Cola de sincronización atascada (outbox).
- Errores de permisos (`permission-denied`).
- Conflictos de concurrencia (`ConcurrencyError`).

## Señales clave en dashboard

Revisar `Admin > System Health` por usuario:

- `pendingMutations`
- `pendingSyncTasks`
- `failedSyncTasks`
- `conflictSyncTasks`
- `retryingSyncTasks`
- `oldestPendingAgeMs`
- Diagnóstico (causas) y `Siguiente acción` sugerida por tarjeta

Umbrales operativos:

- `warning`: `oldestPendingAgeMs >= 5 min` o `retryingSyncTasks >= 1`
- `critical`: `oldestPendingAgeMs >= 15 min` o `retryingSyncTasks >= 3` o `failed/conflict > 0`
- Snapshot técnico base: `reports/operational-health.md`
- Budgets completos: `docs/RUNBOOK_OPERATIONAL_BUDGETS.md`

## Diagnostico rapido del arranque

Cuando el incidente ocurre "solo al abrir" o "tras F5", revisar este orden antes de asumir
pérdida real de datos:

1. `remoteSyncStatus`
   - `bootstrapping`: auth/Firebase aun no terminan de resolver.
   - `ready`: el runtime remoto ya puede leer/suscribirse.
   - `local_only`: la app quedó degradada a modo local.
2. `remoteSyncState.reason`
   - `auth_loading`: bootstrap auth todavía pendiente.
   - `auth_connecting`: hay sesión válida pero el runtime remoto aún no materializa conexión usable.
   - `offline`: degradación por red.
   - `runtime_unavailable`: auth resolvió, pero el runtime remoto/config sigue no usable.
   - `auth_unavailable`: no hay sesión reutilizable.
   - `ready`: remoto operativo.
3. `isFirebaseConnected`
   - si está en `false`, el shell no debe habilitar realtime.
4. `recordRuntime.availabilityState`
   - `resolved` o `recoverable_local`: hay registro usable.
   - `temporarily_unavailable`: falló la lectura remota; no tratarlo como "no existe".
   - `confirmed_missing`: el repositorio sí confirmó ausencia real.
5. `bootstrapPhase`
   - `remote_runtime_bootstrapping`: auth/runtime remoto aun se está rehidratando.
   - `remote_record_bootstrapping`: el runtime está listo, pero la primera lectura del día sigue pendiente.
   - `remote_record_timeout`: la primera lectura remota no resolvió dentro de la ventana esperada.
   - `confirmed_empty`: ausencia real confirmada.
   - `local_only`: degradación a IndexedDB/local.
   - `record_ready`: el registro quedó resuelto para la UI.

Referencia técnica:

- [dailyRecordBootstrapController.ts](../src/hooks/controllers/dailyRecordBootstrapController.ts)
- [useDailyRecordSyncQuery.ts](../src/hooks/useDailyRecordSyncQuery.ts)
- [useDailyRecordQuery.ts](../src/hooks/useDailyRecordQuery.ts)
- [Clinical sync simulator contract](CLINICAL_SYNC_SIMULATOR_CONTRACT.md)

## Procedimiento 1: IndexedDB bloqueado

Síntomas:

- Banner: "Resiliencia de Almacenamiento".
- Logs `IndexedDB` con fallback/mode degraded.

Acciones:

1. Pedir al usuario cerrar pestañas duplicadas de la app.
2. En la alerta usar `Reintentar`.
3. Si persiste, usar `Limpieza Dura` (pierde cache local no sincronizada).
4. Forzar recarga y validar que desaparezca el banner.

Verificación:

- `oldestPendingAgeMs` baja progresivamente.
- Nuevos cambios se guardan sin warning de fallback.

## Procedimiento 2: Cola atascada

Síntomas:

- `pendingSyncTasks` crece.
- `oldestPendingAgeMs` supera 15 min.
- `orphanedTasks` > 0 en telemetría de sync.

Acciones:

1. Confirmar conectividad (`ONLINE` en dashboard).
2. Revisar si el usuario actual heredó ownership local extraño:
   - `ownerKey` de telemetría debe corresponder al usuario autenticado.
   - `orphanedTasks > 0` indica tareas de otra sesión local no drenadas.
3. Esperar 1 ciclo de reintento (backoff).
4. Si no baja, recargar sesión del usuario.
5. Si sigue crítico, solicitar captura de consola y revisar tipo de error:
   - `permission-denied` -> ir a Procedimiento 3.
   - `ConcurrencyError` -> ir a Procedimiento 4.

Verificación:

- `pendingSyncTasks` desciende.
- `retryingSyncTasks` retorna a 0.
- `orphanedTasks` queda en 0 tras cambio de usuario/logout manual.

## Procedimiento 2.2: estados del outbox y accion humana

Usar esta tabla cuando soporte vea tareas en `listRecentSyncQueueOperations` o en
`Admin > System Health`.

| Estado                                | Significado operativo                                                        | Acción segura                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `PENDING` reciente                    | Mutación local aceptada y pendiente de flush remoto.                         | Esperar el backoff normal si la red está degradada. No limpiar cache.    |
| `PENDING` antiguo                     | Mutación no drenada dentro del presupuesto (`oldestPendingAgeMs >= 15 min`). | Validar red/auth, recargar una vez y escalar si no baja.                 |
| `PROCESSING` con `leaseUntil` futuro  | Otra pestaña/worker tiene la tarea reclamada.                                | No reenviar manualmente ni limpiar; esperar expiración o cierre natural. |
| `PROCESSING` con `leaseUntil` vencido | Worker anterior quedó obsoleto; la tarea puede ser reclamada de nuevo.       | Recargar la app o esperar siguiente ciclo online. Escalar si se repite.  |
| `FAILED`                              | Error no recuperable automático, usualmente permisos/configuración.          | Ir a Procedimiento 3 y corregir rol/reglas antes de pedir nuevo intento. |
| `CONFLICT`                            | La mutación local no pudo fusionarse sin riesgo de pérdida.                  | Ir a Procedimiento 4; validar campos afectados antes de resolver.        |

Regla de seguridad: nunca borrar tareas `PENDING`/`PROCESSING` desde soporte si no
hay confirmación explícita de que la mutación ya está reflejada en Firestore y en
la UI del usuario. Un lease vencido debe reintentarse; no es señal de descarte.

Señal avanzada: `sync_queue_stale_claim_noop` indica que un worker intentó
actualizar o cerrar una tarea que ya no tenía reclamada. Es recuperable y suele
aparecer durante carreras multitab o recuperación de leases vencidos. Si se
repite junto a `oldestPendingAgeMs` crítico, escalar con las operaciones recientes
del outbox antes de limpiar cache local.

## Apartado transversal: centro de conflictos clínicos revisables

El flujo normal sigue siendo auto-merge seguro: el usuario clínico no debe ser interrumpido cuando
la autoridad transaccional, la intención clínica y los invariantes permiten resolver. Si queda
evidencia recuperable, `admin` y `nurse_hospital` pueden abrir el centro de conflictos desde:

- censo diario;
- entrega de turno enfermería;
- entrega de turno médica.

Uso operativo:

1. Revisar módulos afectados y pacientes/camas mostrados en el centro.
2. Comparar campos resumidos antes/después.
3. Revisar el impacto anti-rollback de cada versión:
   - `Bloqueado por seguridad clínica`: no preservar desde UI; indica que el snapshot borraría
     hechos clínicos posteriores (movimientos, cama activa, tombstones o duplicados).
   - `Requiere revisión`: puede preservarse, pero el operador debe entender que ocultará contenido
     posterior no bloqueante, usualmente handoff enfermería o entrega médica.
4. Preservar una versión solo si la regla automática eligió una verdad clínica incorrecta.
5. Confirmar que observabilidad registre `CONFLICT_VERSION_RESTORED` con `reviewContext.restoreImpact`.
6. Si no hay snapshots, usar la razón del panel: TTL expirado, permiso denegado, no guardado o
   sin evidencia recuperable.

## Apartado transversal: salud de convergencia clínica

La convergencia clínica es una lectura operacional, no una nueva fuente de verdad. Compara registro
local, remoto, outbox, auditoría reciente y snapshots recuperables para responder si los datos del
censo/entregas están sanos o necesitan intervención.

Estados esperados:

- `healthy`: no hay divergencias activas.
- `recoverable`: hay trabajo pendiente que puede reintentarse sin elegir verdad clínica.
- `needs_review`: hay divergencia clínica o evidencia incompleta; revisar antes de preservar.
- `unsafe`: no se debe resolver automático, por ejemplo paciente activo duplicado.

Regla de seguridad: una acción sugerida por convergencia nunca reemplaza `authority mode`, merge por
intención clínica, invariantes post-merge ni guardrails anti-rollback del centro de conflictos.

Referencia: `docs/ADR_SYNC_CONVERGENCE_HEALTH.md`.

## Procedimiento 2.3: pre-outbox y ack de escritura directa

Las escrituras críticas del censo usan flujo `pre-outbox`: primero persisten el
registro local junto a una tarea `PENDING` en una transacción IndexedDB, luego
intentan la escritura remota directa y finalmente hacen `ack` de la tarea local
por `mutationId` si Firebase confirma la operación.

Lectura operativa:

- Si la pestaña cae después de guardar localmente y antes del remoto, la tarea
  `PENDING` debe quedar disponible para flush posterior.
- Durante los primeros segundos la tarea queda retenida con `nextAttemptAt`
  futuro para que otra pestaña no la procese antes del intento remoto directo.
- Si el remoto directo confirma, la tarea correspondiente debe desaparecer del
  outbox sin pasar por `PROCESSING`.
- Si el remoto falla, la tarea ya existe; el recovery solo debe reutilizarla,
  actualizar contexto/origen y habilitar el procesamiento normal.
- Si el ack local falló pero Firebase ya aplicó la mutación, el siguiente flush
  debe reconocer `remote.meta.lastMutationId == syncContract.mutationId` como
  éxito idempotente y drenar la tarea sin reescribir.
- Si queda una tarea `direct_queue` reciente, no borrar: puede representar una
  confirmación remota pendiente o un ack local que no alcanzó a ejecutarse.

Escalar a ingeniería si aparecen tareas `direct_queue` con edad crítica y sin
errores recientes, porque puede indicar que el ack local o el trigger de recovery
no se ejecutó.

## Procedimiento 2.4: delete/moveToTrash y outbox

Decisión actual: `deleteDay`/`moveToTrash` no usa outbox transaccional.

Motivo:

- Es una operación de ciclo de vida/admin destructiva, no una mutación clínica
  offline-first como editar censo.
- La eliminación local debe ser estricta: si IndexedDB no confirma el borrado,
  la operación se bloquea.
- La limpieza remota (`moveToTrash` + `deleteRemote`) sigue siendo best-effort y
  queda registrada por soporte de lifecycle; no debe bloquear la UI local.

Reabrir esta decisión solo si aparece alguno de estos requisitos:

- borrado offline obligatorio;
- el borrado pasa a ser parte de un flujo clínico visible y frecuente;
- auditoría remota exactamente-una-vez para trash/delete;
- soporte necesita reconciliación retryable de trash remoto.

Si se reabre, implementar primero una tarea explícita tipo tombstone/delete en el
outbox, con idempotencia propia y pruebas de carrera multitab. No reutilizar
`UPDATE_DAILY_RECORD` para modelar un borrado.

## Procedimiento 2.1: contaminación entre sesiones locales

Síntomas:

- un usuario nuevo ve tareas pendientes que no generó;
- `ownerKey` no coincide con la sesión autenticada;
- `orphanedTasks` permanece > 0.

Acciones:

1. Forzar logout manual del usuario actual.
2. Confirmar que el cliente limpie estado sensible local de sesión.
3. Reingresar con el usuario correcto.
4. Si el problema persiste, ejecutar limpieza dura y escalar como incidente de aislamiento de sesión.

Verificación:

- el outbox vuelve a ownership del usuario actual;
- no reaparecen tareas del usuario anterior;
- `pendingSyncTasks` refleja solo actividad actual.

## Procedimiento 3: `permission-denied`

Síntomas:

- Consola: `Missing or insufficient permissions`.
- Outbox en estado `FAILED` sin recuperación automática.

Acciones:

1. Confirmar email y rol del usuario.
2. Validar colección/ruta afectada:
   - Firestore (`hospitals/{id}/...`, `stats/system_health/...`, etc.)
   - Storage (`censo-diario/...`, `entregas-enfermeria/...`)
3. Revisar reglas actuales:
   - `firestore.rules`
   - `storage.rules`
4. Corregir rol/permisos y redeploy de reglas.

Verificación:

- Nuevo intento ya no cae en `FAILED`.
- En dashboard desaparecen fallos de sync para ese usuario.

## Procedimiento 4: Conflicto de concurrencia

Síntomas:

- Error `ConcurrencyError`.
- `conflictSyncTasks > 0`.

Acciones:

1. Revisar `syncContract.changedPaths`, `mutationId`, `clientId` y `tabId` en la operación reciente.
2. Confirmar si el conflicto fue por misma ruta (`same changed path`) o por revisión remota.
3. Si fue por misma ruta clínica, comparar manualmente UI local vs Firestore antes de reintentar.
4. Si la app aplicó merge automático, verificar que campos clínicos locales se preservaron.
5. Validar que cambios administrativos remotos no se perdieron.
6. Confirmar que se encoló actualización consolidada.

Verificación:

- Registro final consistente en UI.
- `conflictSyncTasks` vuelve a 0 tras flush.

## Conflictos por contexto

Si el conflicto fue clasificado por contexto, priorizar esta revisión:

- `clinical`: validar que camas, pacientes y crib clínico preserven la última edición segura.
- `staffing`: confirmar tens/enfermeras y camas extra activas del turno.
- `movements`: revisar altas, traslados y CMA antes de reintentar.
- `handoff`: confirmar notas/responsables de entrega antes de cerrar.
- `metadata`: revisar `lastUpdated`, `schemaVersion`, `dateTimestamp` y reapertura.
- `unknown`: escalar a ingeniería con paths afectados y evidencia.

Referencia: `reports/operational-health.md` y `conflictos por contexto` allí listados.

## Legacy bridge controlado

Si el incidente involucra carga histórica o migración:

1. revisar `reports/legacy-bridge-governance.md`
2. confirmar que el `legacy bridge` no se reinsertó en el hot path
3. usar solo entrypoints explícitas de bridge, nunca lecturas directas legacy

## Diagnóstico local (desarrollo/soporte técnico)

Comandos:

```bash
npm run typecheck
npm run check:quality
npm run check:operational-runbooks
npm run report:operational-health
npm run test:emulator:sync:ci
npm run test:rules:ci
npm run test -- src/tests/integration/sync-resilience.test.ts
npm run test -- src/tests/integration/sync-ui-resilience.test.tsx
```

## Escalamiento

Escalar a ingeniería si ocurre cualquiera:

- Más de 3 usuarios críticos simultáneos por > 30 min.
- `permission-denied` en rutas previamente operativas.
- Corrupción de datos observada (campos vacíos inesperados tras sync).

Adjuntar en el ticket:

- Usuario/email, fecha/hora, hospital.
- Captura dashboard (métricas de sync).
- Error de consola completo.
