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

## Guardados completos y trabajo pendiente

Un guardado completo conserva los valores de las ediciones aceptadas o demuestra
que su base ya los incluía antes de sustituirlos. La comprobación y el reemplazo
comparten la transacción del outbox. `localProjectionBaseIds` registra únicamente
las bases locales incorporadas: no amplía las rutas ni las confirmaciones remotas
de otra tarea en vuelo. La validación usa esa relación para comprobar las rutas de
cada pendiente contra sus valores vigentes, sin ordenar por timestamps. Las tareas
históricas sin ese campo conservan su protección sin inferir una base.
Cada tarea permanece hasta su propia confirmación. Una base obsoleta se rechaza sin cambiar el
registro ni sus tareas, incluso si la copia local falta o quedó atrasada (SAVE-01, SAVE-02).

## Reenvío de campos con base antigua

Una edición por campos conserva sus valores originales en la tarea local existente.
La compactación mantiene el primer valor de cada campo y el contexto original de
identidad y notas del día. La conciliación automática se limita a `pathology` y
`status` de camas o cunas con documento y episodio explícitos. Exige que todos los
ocupantes (madre y RN por separado), episodios y notas sigan iguales a la base y a
la tarea, además de los valores originales de los campos en el servidor. No nace
esta evidencia mientras haya notas de especialista pendientes o retenidas.
Una base vacía, desconocida, con reloj atrasado o revisión que retrocede, un cambio
de identidad, notas o cualquier otra ruta conserva las guardas previas. Tampoco se
renueva la base después de separar cambios de un ocupante que salió.
El transporte usa la versión y revisión leídas para el mismo callable de autoridad;
su transacción rechaza cualquier cambio posterior a esa lectura. Una colisión real
o una tarea antigua sin esta evidencia conserva la revisión existente; no se purga
ni se confirma como guardada.
No requiere cambios en Functions ni reglas (SAVE-01 a SAVE-03).
