# `src/services/storage/sync`

## Contrato

- El engine coordina runtime, store y transport mediante puertos.
- `@/services/storage/sync` es la fachada pública; este directorio no debe ser importado desde UI.
- Los errores de sync deben salir tipados por politica/runtime, no como strings ad hoc.
- El transporte devuelve el registro confirmado; el store adopta el ACK y cierra su
  claim en una transacción. Una tarea posterior sin resolver conserva su proyección
  local, incluso en `FAILED`/`CONFLICT`; un claim obsoleto no puede escribir caché.
- `publicSyncQueue.ts` es la fuente canónica del singleton y de la telemetría pública.
- El surface público canónico del outbox está en `@/services/storage/sync`.

## Límites

- El runtime no conoce React ni hooks.
- El store no conoce Firestore.
- El transport no conoce Dexie.
- La UI solo puede ver outcomes y telemetría resumida a través de fachadas/adapters.

## Invariantes

- Conflictos, retries y degradaciones deben seguir la policy de dominio, no decisiones inline en hooks.
- Los bridges legacy de storage no deben reingresar al camino caliente del sync.
- El backlog de retiros legacy se gobierna desde `reports/compatibility-governance.md`.
- Los módulos productivos deben importar `@/services/storage/sync`; no `syncQueueService`.

## Recuperación silenciosa

El runtime despierta el mismo worker al abrir la aplicación, recuperar conexión, volver a la pestaña y cada 30 segundos mientras haya sesión y conexión. El store sigue respetando nextAttemptAt, leases, retenciones de pre-outbox y cuarentenas; el despertador no borra ni revive conflictos. Una confirmación de otra sincronización no autoriza eliminar un envío diferente. El panel identifica el tipo y fecha del pendiente en vez de mostrar únicamente un contador global.
