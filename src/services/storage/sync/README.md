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

Si la respuesta de una edición se perdió y una corrección se juntó en su tarea, el servidor puede
tener ya esa primera edición. Esa edición pasa a ser la base de la corrección solo si se cumplen
tres condiciones. `meta.lastMutationId` debe ser uno de los identificadores anteriores de la tarea.
El día guardado debe ser la versión que esa edición produjo: cada escritura del servidor pone en
`meta.updatedAt` el mismo valor que en `lastUpdated`, así que cualquier escritura posterior rompe la
coincidencia, incluso una que deje `meta` igual. Y el campo debe estar en `meta.lastChangedPaths`.
En ese caso el valor guardado reemplaza la base del campo en la tarea, y la corrección sigue por la
conciliación de arriba, con la misma exigencia de episodio y versión
(`withOwnEarlierWriteAsBase`). Un texto igual escrito por otro equipo no cumple esas condiciones,
y la tarea queda completa en `CONFLICT`.

Un campo que otro equipo volvió a dejar en su valor base también cambió. Cuenta como cambiado en
otro equipo aunque su valor coincida con la base (`pathsChangedElsewhere`), y la tarea queda en
`CONFLICT` como en cualquier otro cambio, cuando la última escritura del día:

- nombra ese campo o una subruta suya en `meta.lastChangedPaths`;
- no es ninguna de las ediciones de la tarea (`meta.lastMutationId` fuera de sus identificadores);
- vino después de lo último que este equipo había leído del día: `meta.revision` es mayor que la
  revisión base de la tarea y que la del día guardado en la tarea en su última edición. Una
  escritura que la persona ya había leído es el valor sobre el que editó, no un cambio. Un día
  sin revisión cuenta desde 0, como el servidor.

Las partes publicadas o separadas de una tarea se juzgan con la tarea en cola. Una escritura que
nombra la cama o el día entero (`beds.R1`, `*`) no dice que escribió el campo. Solo la última
escritura deja su rastro en `meta`, y la tarea guarda una sola revisión leída, no una por campo: si
este equipo volvió a leer el día después de la restauración mientras su propia edición del campo
seguía pendiente (la celda mostraba su valor), el reenvío no la distingue y publica como antes.

Los datos simples del día (fuera de camas, dotación y movimientos), con el valor base de cada
campo y una versión conocida, se reenvían con la misma escritura que una edición directa
(`updateRecordPartial`, en `plainDayFieldReplay.ts`): su transacción acepta una versión más nueva
solo si cada campo de la tarea conserva su base o ya tiene el valor pendiente. Si no, la tarea
queda completa en `CONFLICT`, sin escritura (SAVE-02).

La publicación vuelve a comparar cada campo con su valor base capturado, antes de
aceptar el registro y dentro de cada intento de la transacción existente. No depende
de que el otro equipo haya escrito `lastChangedPaths` ni de que avance su reloj.
Un cambio incompatible conserva la intención en `CONFLICT`; las combinaciones de
movimientos y notas ya admitidas mantienen su política. Una mutación ya confirmada
conserva su reconocimiento para recuperar una respuesta perdida.
