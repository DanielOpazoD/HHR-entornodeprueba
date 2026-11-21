# Daily Record Authority Rollout

## Objetivo

PR7 permite mover las escrituras completas del censo diario desde una proteccion
principalmente cliente hacia una autoridad transaccional en backend, sin hacer un cambio
big-bang.

## Una sola ruta: la autoridad del servidor

La política `settings/rayenImportPolicy` con `schemaVersion: 2` (la cerca, activa en producción
desde el 2026-11-07) hace que las reglas de Firestore rechacen escrituras directas que creen el día
o toquen `beds` o `bedTypeOverrides`, y las reglas la tratan como irreversible. Por eso el cliente
ya no la lee: desde el 2026-11-20 los guardados completos, el reenvío de la cola y los parches del
árbol de camas pasan siempre por `saveDailyRecordWithClinicalAuthority` o
`patchDailyRecordWithClinicalAuthority`, con `mode: 'enforced'`. Antes cada guardado de cama y
cada reenvío leía la política una vez (dos si fallaba la primera lectura), y una escritura directa
rechazada se reintentaba por la función.

La dotación y los demás campos del día se escriben directo, con su transacción por campo, como
antes. Un `permission-denied` por un rol vencido renueva el permiso y reintenta la misma escritura
una vez.

Ver [SYNC_CONCURRENCY_MODEL.md](SYNC_CONCURRENCY_MODEL.md).

## Estado vigente

Con dos personas guardando a la vez
(`src/tests/emulator-ui/productionAuthorityConfiguration.emulator-ui.test.ts`, que reproduce la
configuración de producción):

- árbol de camas, dotación, guardado completo del día y reenvío de la cola: una de las dos se
  rechaza y su edición queda como conflicto por resolver;
- los demás campos del día (novedades de entrega, camas extra) se escriben en una transacción que
  compara cada campo con la versión que leyó quien escribe.

## Secuencia para un entorno nuevo sin política v2

1. Desplegar Functions y reglas: el cliente guarda camas y días completos por la autoridad aunque
   la política no exista todavía.
2. Revisar el panel admin de telemetria de Functions, seccion
   `Autoridad censo diario`. Debe mostrar `Listo para enforced` antes de activar la cerca.
3. Si se necesita auditoria fina, filtrar `functionsTelemetry` por:
   - `service = dailyRecordWriteAuthority`;
   - `operation = saveDailyRecordWithClinicalAuthority` o
     `patchDailyRecordWithClinicalAuthority`;
   - `authorityStatus`;
   - `fallbackEpisodeKeys`;
   - `degenerateFallbackEpisodeKeys`;
   - `violationCount`.
4. Si no aparecen fallos inesperados, publicar la política v2 para que las reglas cierren la
   escritura directa (frontera irreversible, ver Rollback).

## Freshness De Pestañas Inactivas

Con la cerca, una pestaña reactivada despues de inactividad no debe aceptar ediciones
clinicas hasta confirmar Firebase. La confirmacion puede llegar por query/refresh manual,
snapshot realtime sin `hasPendingWrites` o escritura aceptada. Durante ese intervalo solo
se bloquean campos y acciones clinicas sensibles; lectura, navegacion de historial y
documentos clinicos siguen disponibles.

## Contrato De Revision

Las escrituras completas y parches clinicos deben enviar `syncContract` al backend
cuando usen la autoridad transaccional. Soporte/ingenieria debe revisar:

- `expectedVersion`: version local usada como base de concurrencia.
- `baseRevision`: revision remota esperada en `record.meta.revision`.
- `recordRevision`: version del registro que se intenta publicar.
- `mutationId`, `clientId`, `tabId`: identidad de mutacion para trazabilidad y ack
  del outbox local.
- `changedPaths`: rutas semanticas afectadas. En full save puede ser `*`.

Un rechazo `revision_mismatch` es esperado cuando `baseRevision` no coincide con
Firebase; no tratarlo como fallo de red. Validar la UI local contra el registro
remoto antes de forzar un nuevo intento.

Medir en telemetria:

- `daily_record_resume_refresh_started`: inicio del bloqueo por inactividad.
- `daily_record_resume_refresh_completed`: cierre del bloqueo. Revisar `blockedForMs`,
  `source`, `consistencyState` y `sourceOfTruth`.
- `daily_record_clinical_patch_blocked_until_fresh`: intento de escritura clinica antes
  de confirmar frescura remota.
- `daily_record_resume_refresh_failed`: bloqueo persistente por Firebase no confirmado.

Gate operativo para llamar estable al rollout: p95 de `blockedForMs` menor a 3 segundos
en red hospitalaria normal, cero `remote_unavailable` sostenidos y sin reportes de exito
clinico antes de persistencia aceptada en altas, traslados, undo y auditoria.

## Rollback

No hay rollback por configuración del cliente. Con la política Rayen v2 activa, las reglas tratan
el árbol de camas como frontera irreversible: volver a la escritura directa exige cambiar reglas y
política, y lo decide el responsable.

Si el problema es especificamente bloqueo por frescura al reactivar pestañas: mantener realtime
activo, limpiar cache local solo en usuarios afectados y revisar eventos
`daily_record_resume_refresh_failed`.

## Privacidad De Telemetria

La telemetria de autoridad no debe registrar RUT, nombre, diagnostico ni notas clinicas.
Solo registra conteos, modo, origen, fecha del registro, estado de autoridad y tipos de
violacion.

## Senales A Vigilar

- Aumento de `permission-denied`: revisar roles/claims antes de activar `enforced`.
- Aumento de `failed-precondition`: revisar duplicados o episodios cerrados activos.
- `degenerateFallbackEpisodeKeys > 0`: hay pacientes activos sin identidad de episodio
  suficientemente fuerte; conviene revisar adopcion de `clinicalEpisodeId`.
- Recomendacion `Investigar antes de activar` en el panel: no pasar a `enforced` hasta
  entender el bloqueo o el fallback degenerado.
