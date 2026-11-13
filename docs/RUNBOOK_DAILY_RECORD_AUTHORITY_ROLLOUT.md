# Daily Record Authority Rollout

## Objetivo

PR7 permite mover las escrituras completas del censo diario desde una proteccion
principalmente cliente hacia una autoridad transaccional en backend, sin hacer un cambio
big-bang.

## Modos

- `client_only`: modo por defecto. El cliente mantiene las validaciones locales y escribe
  directo a Firestore.
- `enforced`: las escrituras completas directas, los parches clinicos parciales y las
  publicaciones del outbox pasan por autoridad transaccional:
  `saveDailyRecordWithClinicalAuthority` o `patchDailyRecordWithClinicalAuthority`.

Compatibilidad: `VITE_DAILY_RECORD_AUTHORITY_CALLABLE=true` equivale a `enforced`.
El flag recomendado para rollout nuevo es `VITE_DAILY_RECORD_AUTHORITY_MODE`. El valor `shadow`
se retiró como modo del cliente: si aparece en la variable se ignora.

El flag no es la única fuente del modo. `resolveEffectiveDailyRecordAuthorityMode` usa el más
fuerte entre el flag y la política `settings/rayenImportPolicy` (`schemaVersion: 2`,
`clinicalBatchMode`). Si esa política v2 existe, las reglas de Firestore rechazan escrituras
directas que toquen `beds` o `bedTypeOverrides`, y el cliente envía guardados completos, outbox y
parches de cama a los callables aunque el flag diga `client_only` (con `mode: 'shadow'`, que el
servidor confirma igual que `enforced`; sólo `dryRun` no escribe). Ver
[SYNC_CONCURRENCY_MODEL.md](SYNC_CONCURRENCY_MODEL.md).

## Estado vigente (medido el 2026-11-12)

Producción publica con la variable sin definir (`client_only`), pero su política
`settings/rayenImportPolicy` es v2 con `clinicalBatchMode: enforced` desde el 2026-11-07, así que
el modo efectivo ya es `enforced`. Con dos personas guardando a la vez
(`src/tests/emulator-ui/productionAuthorityConfiguration.emulator-ui.test.ts`, que reproduce esa
configuración):

- árbol de camas, dotación, guardado completo del día y reenvío de la cola: una de las dos se
  rechaza y su edición queda como conflicto por resolver. Cambiar la variable no altera ninguna de
  estas rutas;
- los demás campos del día (novedades de entrega, camas extra) se escriben directo, con una
  comprobación de versión previa que rechaza a quien llega con una base más antigua. Esa
  comprobación y la escritura no son una sola operación: dos personas con la misma base, en el
  mismo instante, reciben ambas «guardado» y prevalece la última. Las pruebas lo documentan como
  falla esperada. El intento de cerrarlo (#1512) se descartó porque no se pudo acreditar que el
  resto del guardado quedara igual; se reabre solo con evidencia de que ocurre.

## Secuencia para un entorno nuevo sin política v2

1. Desplegar con `VITE_DAILY_RECORD_AUTHORITY_MODE=client_only`.
2. Revisar el panel admin de telemetria de Functions, seccion
   `Autoridad censo diario`. Debe mostrar `Listo para enforced` antes de activar el modo
   obligatorio.
3. Si se necesita auditoria fina, filtrar `functionsTelemetry` por:
   - `service = dailyRecordWriteAuthority`;
   - `operation = saveDailyRecordWithClinicalAuthority` o
     `patchDailyRecordWithClinicalAuthority`;
   - `authorityStatus`;
   - `fallbackEpisodeKeys`;
   - `degenerateFallbackEpisodeKeys`;
   - `violationCount`.
4. Si no aparecen fallos inesperados, cambiar a `enforced`.

## Freshness De Pestañas Inactivas

En `enforced`, una pestaña reactivada despues de inactividad no debe aceptar ediciones
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

Volver a `VITE_DAILY_RECORD_AUTHORITY_MODE=client_only` deja las validaciones cliente activas
y desactiva el uso obligatorio del callable. Si se estaba usando el flag legacy, remover
`VITE_DAILY_RECORD_AUTHORITY_CALLABLE=true`. Con la política Rayen v2 activa, este rollback no
devuelve la escritura directa del árbol de camas: las reglas la tratan como frontera irreversible.

Si el problema es especificamente bloqueo por frescura al reactivar pestañas, rollback
operativo inmediato: volver a `client_only`, mantener realtime activo, limpiar cache local
solo en usuarios afectados y revisar eventos `daily_record_resume_refresh_failed` antes de
reintentar `enforced`.

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
