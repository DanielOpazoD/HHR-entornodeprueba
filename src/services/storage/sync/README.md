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
- El backlog de retiros legacy se sigue en `docs/LEGACY_RETIREMENT_PLAN.md`.
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

El servidor anota en cada guardado (parche, guardado completo y lote de Rayen) qué edición escribió
cada campo que ese guardado cambió: `meta.fieldWrites` (`functions/lib/dailyRecordFieldWrites.js`).
El parche anota sus rutas y las de especialidad que cambió el servidor; el guardado completo y el lote
de Rayen, las rutas cuyo valor difiere del día guardado. Por campo guarda la revisión que lo escribió
y una huella del valor guardado; por revisión, la edición (`mutationId`) y el equipo (`clientId`).
Una ruta escrita reemplaza su entrada y las de debajo; las demás se conservan, y quedan las 300 más
nuevas. El ajuste administrativo de CUDYR y la aplicación de la política de especialidad también anotan lo
que cambian, sin edición de nadie. El mapa guarda la revisión con que se actualizó (`revision`) y si
ese guardado corrió bajo la valla clínica de Rayen (`fenced`: con la política v2 las reglas impiden
al cliente cambiar `beds` y `bedTypeOverrides`, `preservesServerOwnedClinicalState`). Una escritura
que no lo actualiza la detecta el guardado siguiente del servidor:

- la restauración (o cualquier escritor del servidor que no anote) deja el mapa bajo la revisión
  del día: el mapa marca `incompleteThrough` y ninguna entrada de esa revisión o anterior acredita
  un campo;
- una escritura directa del cliente (novedades y listas de la entrega, dotación, y el reenvío de
  esos datos) deja un `lastUpdated` que no es el sello `meta.updatedAt` del servidor. Entre dos
  guardados bajo la valla solo pudo cambiar datos del día fuera de las camas: el mapa marca
  `outsideBedsIncompleteThrough` y el corte vale solo para esos campos. Sin la valla en alguno de
  los dos, marca `incompleteThrough`.

Solo lo escribe
el servidor: las reglas de Firestore no cambian. El reenvío lo lee con `fieldWriteAttribution.ts`,
con la misma huella; un día guardado sin ese dato, o cuya última escritura no lo actualizó, se lee
también por su última escritura (`meta.lastMutationId` y `meta.lastChangedPaths`), como antes, salvo
que el mapa dé ese identificador a una revisión anterior (la escritura lo heredó, no lo escribió).

Si la respuesta de una edición se perdió y una corrección se juntó en su tarea, el servidor puede
tener ya esa primera edición. Esa edición pasa a ser la base de la corrección en cada campo donde la
escritura más nueva que lo toca es una de las ediciones anteriores de la tarea, escribió ese mismo
campo, sigue acreditada (la última escritura del día es del servidor, el mapa está en la revisión del
día y la entrada es posterior a `incompleteThrough`) y dejó el valor que guardó (la huella coincide
con el valor guardado ahora). Que otro equipo haya guardado otro campo después, por parche, guardado
completo o lote, no cambia nada. Si no, el campo se decide por sus valores, como antes del mapa. En ese caso el valor guardado reemplaza la base del campo en la tarea,
y la corrección sigue por la conciliación de arriba, con la misma exigencia de episodio y versión
(`withOwnEarlierWriteAsBase`). Un texto igual escrito por otro equipo no cumple esas condiciones, y
la tarea queda completa en `CONFLICT`.

Un campo que otro equipo volvió a dejar en su valor base también cambió. Cuenta como cambiado en
otro equipo aunque su valor coincida con la base (`pathsChangedElsewhere`), y la tarea queda en
`CONFLICT` como en cualquier otro cambio, cuando una escritura anotada:

- escribió ese campo o una subruta suya;
- no es ninguna de las ediciones de la tarea ni de este equipo (su `clientId`: lo que este equipo
  guardó ya lo mostraba su censo);
- vino después de la revisión en que la tarea leyó ese campo (`patchBaseRevisions`, la del día que
  mostraba el censo al editarlo). Una escritura que la persona ya había leído es el valor sobre el
  que editó, no un cambio. Una tarea encolada sin ese dato usa lo último que había leído del día:
  su revisión base y la del día guardado en la tarea en su última edición. Un día sin revisión
  cuenta desde 0, como el servidor.

Las partes publicadas o separadas de una tarea se juzgan con la tarea en cola. Una escritura que
nombra la cama o el día entero (`beds.R1`, `*`) no dice que escribió el campo. Las escrituras
directas del cliente y los escritores del servidor que no actualizan el mapa no dejan rastro por
campo: mientras son la última escritura se leen por su `meta`, y después `incompleteThrough` impide
atribuir a la tarea un valor anterior a ellas, aunque vuelva a ser el mismo texto.

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
