# Diseño fase 1: datos clínicos derivados fuera del registro del día

**Estado:** Aprobada (2026-10-23). P3 (#997), P4a (#1002), P5 (#1003) y P4b (#1004) están en
`main`. P6 fija la fecha de inicio y la versión mínima 3; al fusionarse despliega Functions, y la
división empieza en esa fecha (ver Activación).
**Ámbito:** fase 1a de `ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.md`.
**Relacionado:** `ADR_DAILY_CENSUS_CLINICAL_DATA_OWNERSHIP.md`,
`ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`, `ADR_CONFLICT_VERSION_RECOVERY.md`,
`rayen-incremental-clinical-sync.md`, `RUNBOOK_RAYEN_CLINICAL_ENRICHMENT_BATCH.md`.

## Qué se mueve y qué no

Según los comentarios medidos del servidor (`HEAVY_DERIVED_BED_FIELDS`), cada episodio ocupado (cama
o cuna clínica) lleva en el día unos 17 KB de `clinicalSyncCheckpoint`, unos 13 KB de
`vitalSignsHistory` y unos 7,5 KB de `evaluationScores`. El registro del día se estima en unos
0,5 MB, es decir, unos 13 episodios.

| Fase               | Campos                                        | Se queda en el día                                                                                  |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1a                 | `clinicalSyncCheckpoint`, `vitalSignsHistory` | `vitalSigns`: lo muestra la celda del censo y el arrastre del servidor depende de él                |
| 1b, diferida (D15) | `evaluationScores.history`                    | `cudyr`, `braden`, `downton`, `clinicalCarryover`                                                   |
| Aparte             | diagnósticos de `rayenSyncHistory`            | la autoridad de cada corrida, porque el servidor la verifica dentro de la misma transacción del día |

La fase 1a reduce unos 30 KB por episodio: de unos 0,5 MB a unos 0,11 MB con 13 episodios (−78 %).
Achica en la misma proporción cada descarga del día, las copias de historial y de conflicto y las
fotos de movimientos (`originalData`). `daily_record_size_observed` (#975) mide la ganancia real
después de activar.

El diseño no depende del modo del enriquecimiento (`clinicalBatchMode` `off`, `shadow` o
`enforced`) ni de si la valla de escritura (`settings/rayenImportPolicy` con `schemaVersion` 2) está
activa: cubre los dos escritores (parche con guarda y lote) y las dos rutas de guardado completo
(callable y escritura directa del cliente).

## Decisiones tomadas

### Datos

- **D1. Ruta.** `hospitals/{hospitalId}/dailyRecords/{fecha}/clinicalDerived/{clinicalEpisodeId}`:
  un documento chico por día y episodio.
  - Por día, porque todo lector trabaja sobre un día y el dato es "a esa fecha": el checkpoint se
    reinicia cada día y los signos vitales se copian a cada día.
  - El id es el `clinicalEpisodeId` y debe cumplir `/^[A-Za-z0-9_-]{1,120}$/` y no tener la forma
    `__x__`. Así quedan fuera `/`, `.`, `..` y `__x__`, que Firestore no admite; los `ep_` y
    `legacy_ep_` de `clinicalEpisodeIdPolicy.ts` cumplen. Un episodio sin id válido guarda sus campos embebidos en
    el día, como hoy.
  - Madre y recién nacido son episodios distintos: el servidor rechaza un mismo id activo dos veces
    (`duplicate_active_episode` en `dailyRecordClinicalAuthorityPolicy.js`). Ningún documento de
    identidad se normaliza: un pasaporte sigue siendo pasaporte.
  - Precedente: `specialtyDecisions` ya es una subcolección del día que solo escribe el servidor.
- **D2. Documento del episodio.**

  ```text
  { schemaVersion: 1, date, clinicalEpisodeId, layoutGeneration, target: 'bed' | 'clinicalCrib',
    bedId, dayRevision, updatedAt, lastMutationId, clinicalSyncCheckpoint, vitalSignsHistory }
  ```

  - `target` y `bedId` son informativos y se reescriben en cada escritura.
  - `dayRevision` es la revisión del día escrita en la misma transacción.
  - El servidor escribe siempre los dos campos movidos (`null` si no hay valor). Así, para un
    episodio con documento, una copia embebida vieja nunca gana.

- **D3. Marcador del día.** Campo raíz `clinicalDerivedLayout = { version: 1, generation }`, con
  `generation` generada por el servidor.
  - Solo el servidor lo pone, con una generación nueva. El servidor ignora el marcador que manda
    un cliente y decide él.
  - Reglas: ningún cliente crea un día con marcador, ni siquiera un día recreado desde IndexedDB o
    desde un JSON; los clientes lo quitan al crear o recrear un día (P4). Una actualización deja el
    marcador exactamente como está; no lo agrega, no lo cambia y no lo quita. En un día marcado tampoco puede bajar `meta.revision` (ver "Semántica de la
    revisión").
  - Los clientes copian el marcador remoto en sus guardados directos completos y en la restauración
    de versiones (D9).
- **D4. Superposición.** Pura: nunca modifica su entrada.
  - Busca el documento solo por `clinicalEpisodeId`, esté el episodio en una cama o en una cuna. Un
    traslado cuna↔cama del mismo día conserva el id.
  - Solo cuentan los documentos con `layoutGeneration` igual a la generación del marcador y `date`
    igual a la fecha del día. Sin marcador no se superpone nada.
  - Campo por campo: si el documento tiene el campo, gana aunque sea `null` (`null` deja el campo
    ausente); si no lo tiene, queda la copia embebida.
  - Si un id está activo más de una vez en el día, no se superpone: el modo estricto falla cerrado.
  - No toca `rut`, `documentType`, `lastUpdated` ni `meta`.

### Servidor

- **D5. Interruptor.** Variable de entorno de Functions
  `HHR_CLINICAL_DERIVED_SPLIT_FROM=AAAA-MM-DD`.
  - Se lee en cada llamada, como `HHR_SPECIALTY_EPISODE_ASSIGNMENT`. Solo una fecha estricta la
    enciende; cualquier otro valor la deja apagada, y por defecto está apagada.
  - Solo el servidor marca un día: cuando crea un día con fecha igual o posterior a la de inicio, o
    en su primera escritura de un campo movido en un día con fecha igual o posterior.
  - Decide la fecha **objetivo** (`date`), nunca la de autoridad (`authorityDate` o `sourceDate`).
  - Un día ya marcado lo gobierna su marcador, no la variable. Los días anteriores nunca se migran
    ni se purgan.
- **D6. Primera escritura dividida.** La primera escritura dividida de un episodio borra sus copias
  embebidas: con `FieldValue.delete()` en el parche y omitiéndolas en el `set` del lote. Ahí está la
  ganancia de tamaño. Los episodios que aún no se escriben conservan su copia embebida, y la lectura
  campo por campo la usa.
- **D7. Valla por versión de cliente.** Los callables aceptan escrituras de campos movidos en días
  marcados, o que esa escritura marcaría, solo si el payload trae `clientRuntimeContractVersion >= 3`.
  - Es un campo raíz aparte, fuera de digests y recibos. Si falta o es menor:
    `failed-precondition` con `clinical_derived_client_outdated`.
  - La versión mínima de cliente publicada sube en la activación, pero es solo un aviso. La publica
    `netlify/functions/runtime-contract.js` con la publicación web, el cliente se bloquea a sí mismo
    (`VersionContext.tsx`) y ninguna Function la lee. Esta verificación por solicitud es la valla
    real.
- **D8. Respuesta.** En días divididos, `recordState.record` de los callables de autoridad (guardado
  y parche) es el día tal como quedó guardado: con el marcador y sin los campos movidos de los
  episodios con documento.
  - Coincide con lo que devuelven el camino idempotente y la relectura tras una respuesta perdida
    (`dailyRecordAuthorityTransport.ts`).
  - Nunca se devuelve un registro superpuesto. El lote no devuelve registro.
- **D11. Recuperación.** La copia de historial de la corrida se escribe en la misma transacción
  (`rayen-{runId}` del parche y `rayen-clinical-…` del lote). En `clinicalDerivedPrevious` guarda, por
  episodio, sus campos movidos tal como estaban antes de que la corrida lo escribiera por primera
  vez.
  - Si había documento, ese documento (de cualquier generación). Si no, la copia embebida que la
    escritura borra.
  - Una corrida tiene varios parches o lotes. Si la copia ya existe, la misma transacción le agrega
    los episodios que faltan.
  - Nunca pesa más que la copia completa que hoy escribe el lote para los mismos episodios, y se
    revisa con el mismo control de 900 KB del lote.
  - Un lote de solo checkpoint sigue sin copia de historial. El checkpoint es un índice de la
    sincronización incremental, no un dato clínico: perder un valor anterior solo obliga a
    revalidar.
- **D13. Paridad.** `PARITY_CONTRACT_VERSION` (`rayenClinicalEnrichmentFunctions.js`) sube a 3, y la
  paridad en `shadow` compara la vista combinada (documentos sobre el día). La evidencia anterior
  deja de contar para el paso de `shadow` a `enforced` (`functionsTelemetryService.ts`).
- **D16. Copia adelgazada del lote.** El lote cambia su copia completa por `buildSlimHistorySnapshot`
  en un PR aparte, después de P5. La copia adelgazada conserva `clinicalDerivedPrevious`. En días sin
  marcador deja de guardar los valores embebidos anteriores, como ya pasa hoy con el parche con
  guarda.

Cómo cambia cada escritor del servidor:

- **Regla común.** En un día marcado, o que esa escritura marca, el servidor:
  - lee los documentos de los episodios que va a escribir antes de la primera escritura de la
    transacción, con los ids del día remoto ya leído;
  - arma la vista combinada con la misma superposición de D4, y sobre ella compara, aplica y
    verifica;
  - escribe el día como el remoto más su cambio, nunca la vista combinada, y cada documento
    completo con `set`.

  La lógica nueva vive en módulos propios: `functions/lib/clinicalDerivedContract.js` (gemelo del
  contrato del cliente) y `functions/lib/clinicalDerivedStore.js` (interruptor, lecturas y plan de
  escrituras). Los callables solo reciben enganches cortos; `dailyRecordWriteAuthorityFunctions.js`
  ya tiene 2041 líneas. `FieldValue` hoy no llega a las fábricas (`functions/index.js`), así que P5
  lo pasa.

- **Parche con guarda** (`patchDailyRecordWithClinicalAuthority`, modos `off` y `shadow`). Si el
  parche toca campos movidos y el día está marcado o se marca ahora:
  - exige la versión de cliente (D7) y lee los documentos junto con las demás lecturas;
  - saca de `txnUpdate` las rutas de campos movidos y las lleva al documento del episodio;
  - en el día deja los dos campos de ese episodio como `FieldValue.delete()` y, si marca el día,
    agrega el marcador al mismo `update`;
  - usa `dayRevision = patchedRecord.meta.revision`; `lastChangedPaths` conserva las rutas lógicas.
- **Lote** (`applyRayenClinicalEnrichmentBatch`; en `shadow` solo verifica). Lee los documentos de
  los objetivos justo después del día.
  - La detección de no-op, la aplicación y la paridad usan la vista combinada. Hoy, en `shadow`, la
    paridad compara contra `remoteData`.
  - Escribe el día desde el remoto, sin los campos movidos de los objetivos, y los documentos con la
    revisión de `buildClinicalEnrichmentMeta`.
  - Revisa con `assertPersistedDocumentSize` cada documento que escribe.
  - En días marcados rechaza `fieldContractVersion` 1 con campos movidos: su mezcla recursiva
    (`applyLegacyPatchValue`) necesita el valor combinado, y un cliente v3 siempre manda la
    versión 2.
- **Guardado completo** (`saveDailyRecordWithClinicalAuthority`).
  - Día marcado existente: copia el marcador remoto (ignora el del cliente) y toma los campos
    movidos del remoto por `clinicalEpisodeId`, con o sin valla. No los quita: un día marcado a
    mitad de vida todavía tiene episodios cuya única copia está embebida. Hoy
    `preserveRayenClinicalFields` usa la clave `crib:`/`patient:`; para estos dos campos en días
    marcados, la clave es solo el episodio.
  - Creación: con fecha igual o posterior a la de inicio, pone un marcador con generación nueva. Si
    el día anterior está marcado, lee sus documentos y los superpone antes de
    `applyTrustedClinicalCarryover`.
  - La creación no escribe documentos de episodio. Lo sembrado, y lo que traiga una restauración de
    respaldo del administrador, queda embebido hasta la primera escritura dividida de cada episodio.
  - Nunca marca un día existente.
- **Otros escritores del día** (`setAdminCudyrResult`, la aplicación de la política de especialidad
  y las firmas de entrega): copian el día remoto o escriben rutas sueltas, así que conservan el
  marcador. No cambian.

### Clientes

- **D9. Higiene en días marcados.** Un cliente nunca escribe campos movidos de su copia local:
  - El auto-merge de conflicto toma los campos movidos y el marcador solo del remoto. Si el remoto
    no los tiene, el resultado tampoco.
  - Dos escrituras directas leen el remoto en la misma transacción: la publicación directa de la
    cola (`firestoreSyncTransport.ts`, `merge: true`) y el guardado directo completo
    (`saveRecordAtomically` en `firestoreWriteSupport.ts`, que también usa la restauración de
    versiones). Quitan los campos movidos locales y llevan el marcador, `meta` y, por episodio, los
    campos movidos del remoto.
  - Así no borran la copia embebida de un episodio aún no dividido. Además, como las escrituras
    directas no suben la revisión, tampoco la bajan.
  - Límite conocido: la actualización parcial directa (`updateRecordPartial`; mover o copiar un
    paciente escribe `beds.<cama>` completo) no pasa por esta higiene y puede volver a incrustar
    valores locales en un día marcado. Solo agrega peso: la superposición toma el documento del
    episodio y la siguiente escritura dividida de ese episodio borra la copia. Con la valla de
    Rayen de esquema v2, las reglas niegan esos cambios del cliente en `beds`. Se mide con
    `vitalsHistoryBytes` y `checkpointBytes` de los días divididos; antes de 1b el responsable
    decide si se cierra.
- **D10. Lectores.** Lo superpuesto nunca entra al repositorio, a `docToRecord`, a la caché de
  TanStack, a IndexedDB, a la cola, a las copias de conflicto ni a `originalData`.
  - Todos leen por el mismo servicio. Si el lector de documentos no carga ni al segundo intento
    (sin conexión, o un hash viejo tras una publicación), la lectura falla como cualquier lectura
    fallida y el servicio la reporta una vez en `clinical_derived_read`, con el código
    `reader_unavailable` y el alcance día o episodio.
  - **Relleno clínico de Rayen.** Superpone cada registro que llega a la reconstrucción
    (`rebuildClinicalEnrichmentOperations`). Son tres: `freshRecord` (`useRayenClinicalFill.ts`,
    tanto con la entrega confirmada como al recargar), `refreshRecord` del lote y el registro actual
    de `patchFreshClinicalRecord`.
    - Lee el día del servidor (`getAuthoritativeForDate`), no con la lectura habitual, que puede
      venir de la caché y repetir el desfase. Luego, si está marcado, lee sus documentos del
      servidor; en `patchFreshClinicalRecord` basta el del episodio del parche.
    - Excepción: `patchFreshClinicalRecord` sigue leyendo el día con la lectura habitual, porque
      ese día también es la base de su escritura y deja a la vista de la reconstrucción las
      ediciones locales pendientes que hoy la frenan. Su relectura usa esa misma lectura, y la
      reconstrucción y la escritura usan siempre el mismo día; la verificación de versión exacta
      del servidor rechaza una base atrasada.
    - Si un documento que cuenta trae `dayRevision` mayor que `meta.revision` del día, relee ambos
      una vez. Si sigue, falla cerrado como cuando hoy no carga el registro: mismo aviso y token de
      reintento. Esa falla cerrada (día atrasado, episodio repetido o marcador desconocido) queda en
      `clinical_derived_read` con su motivo; las lecturas fallidas ya las reporta el lector.
    - Una corrida que espera su política no lee documentos, y el refresco del día después de un
      lote confirmado tampoco: solo relee el día.
    - El registro base que reciben las escrituras (`baseRecord` de `updatePartialDetailed`) nunca se
      superpone, porque se guarda en IndexedDB y en la cola.
    - `loadFreshClinicalRecord` no cambia: solo alimenta la auditoría y la revisión de dotación.
  - **Ventana de signos vitales.** Recibe la fecha, el episodio y el marcador del día.
    - Al abrirse lee el documento de su episodio, sin listener y con la fuente por defecto del SDK.
    - Si el documento tiene `vitalSignsHistory`, gana (`null` = vacío). Si no, usa la copia
      embebida o el resumen.
    - Un episodio activo más de una vez en el día no lee su documento (D4).
    - Sin conexión, si el SDK tiene el documento en su caché, lo muestra. Si no lo tiene, o ante
      cualquier error, muestra lo mismo que hoy.
  - **Creación del día en el cliente** (`dailyRecordRepositoryInitializationService.ts`). Solo
    cuando el destino es hoy, superpone una copia del día fuente antes de sembrar el arrastre (mejor
    esfuerzo). Si falla, siembra como hoy. Solo se guarda el día nuevo. Si la superposición lanza
    (por ejemplo, no carga el servicio de lectura), el día nuevo se siembra sin el historial de
    signos de los documentos de episodio: queda en `clinical_derived_read` con el motivo
    `carryover_overlay_failed`, sin el texto del error.
  - **Herramienta de personal** (`recoverCensusStaff.ts`). En los días marcados lee todos los
    documentos de episodio y recorre cada uno como un paciente suelto, además del día.
    - Un día que no se puede leer, o con un marcador que este cliente no entiende, no detiene la
      búsqueda: el catálogo solo agrega nombres, así que se publica lo encontrado y el mensaje dice
      cuántos días faltaron.
  - **Respaldos JSON** (el local de `exportService.ts` y los mensuales y anuales de
    `dataMaintenanceService.ts`).
    - La exportación agrega por día una sección `clinicalDerived` con los documentos de los días
      marcados, leídos del servidor. Un día que no se pudo leer queda indicado, no se omite.
    - La sección va en la raíz del archivo (en el respaldo local, junto a las fechas) y solo
      existe si hay días marcados: `{ [fecha]: { status: 'exported', layoutGeneration, docs } }`
      o `{ status: 'unavailable', reason }`.
    - Si algún día queda `unavailable`, el archivo se descarga igual, pero la exportación se
      informa incompleta, con las fechas y la indicación de repetirla con conexión.
    - La importación no escribe esa sección y nunca reemplaza un registro local marcado más nuevo
      por uno sin marcador (esto último lo hace P4a, en la higiene de escritura).
    - Limitación conocida: un cliente anterior a P4 (por ejemplo, tras restaurar una publicación
      anterior) leería la sección del respaldo local como un día más y guardaría en IndexedDB un
      registro con fecha `clinicalDerived`. Los días reales no cambian.

Piezas comunes del cliente:

- El contrato gemelo `src/services/storage/clinicalDerivedContract.ts` tiene una prueba de
  alineación con el servidor, como `dailyRecordAuthorityContractAlignment.test.ts`: la misma matriz
  sintética de superposición sobre las dos copias.
- El lector de Firestore devuelve un resultado tipado (`resolved`, `permission_denied`, `failed`).
  - Nunca devuelve una lista vacía ante un error (`scripts/check-empty-on-failure-reads.mjs`).
  - No usa `logFirestoreQueryError`, que reporta la denegación al detector de tormentas de permisos
    y puede cerrar la sesión.
- La superposición y el servicio de lectura se cargan con import dinámico y quedan fuera del
  precache de instalación: sin ellos, los lectores de mejor esfuerzo muestran lo embebido.
- Costo de lectura en días marcados:
  - cada carga del relleno y cada `refreshRecord`: una lectura del día y una consulta de unos 13 a
    26 documentos;
  - cada parche por paciente (modos `off` y `shadow`): una lectura del día y una del documento
    (dos de cada una si el documento va adelante);
  - cada apertura de la ventana: una lectura;
  - la herramienta de personal y las exportaciones: una consulta por día.

  No se agregan listeners.

### Operación

- **D12. Exenciones de índice.** `clinicalDerived.clinicalSyncCheckpoint` y
  `clinicalDerived.vitalSignsHistory` (grupo de colecciones), más `history.clinicalDerivedPrevious`,
  que D11 agrega a las copias de historial. Las tres se despliegan con las reglas, antes de activar.
  La exención de `beds` solo cubre `dailyRecords`, `history` y `deletedRecords`.
- **D14. Restos de un día borrado.** Los documentos de un día borrado se ignoran por la generación
  del marcador: un día que recrea el servidor recibe una generación nueva. Nunca se borran.
- **D15. Fase 1b diferida.** `evaluationScores.history` espera a que la medición por campo la
  justifique. Antes de moverlo, `braden.latestApplication` y `downton.latestApplication` deben estar
  siempre en el día: sin ellos, los chips del censo y la agudeza de la fila leen
  `evaluationScores.history` (`evaluationScoresCellController.ts`, `rowAcuityController.ts`).

## Riesgos y cómo se cubren

- **Adopción de `recordState`.** El cliente guarda en IndexedDB, como verdad, el
  `recordState.record` que devuelven los callables de autoridad. Hoy el parche lo arma con
  `buildAuthorityRecordState` desde `patchedRecord`, que aún tiene los valores movidos.
  - D8: en días divididos se devuelve el día guardado.
  - Con una escritura local pendiente, la adopción vuelve a aplicar el parche
    (`rebasePendingDailyRecordWrite`), y la copia local puede quedar otra vez con valores movidos.
    Son los recién escritos. La publicación de la cola y el guardado completo no los suben (D9);
    una actualización parcial directa sí puede (límite conocido de D9).
- **Auto-merge que resucita copias.** Cuando el remoto no tiene un campo, gana el local
  (`remote_undefined_fallback` en `conflictResolutionPolicy.ts`). `vitalSignsHistory` sigue ese
  camino, y el checkpoint se rearma desde el local (`mergeUnknown`). D9 lo corta: estos campos y el
  marcador salen solo del remoto.
- **Restauración de versión que bota el marcador.** Con la valla apagada, la restauración guarda
  completo el registro de la copia (`dailyRecordVersionRestoreController.ts` →
  `transaction.set(docRef, record)`). Una copia anterior al marcado quitaría el marcador, volvería a
  poner valores viejos y bajaría la revisión.
  - D3 y D9: el guardado directo completo lleva el marcador, `meta` y los campos movidos del remoto.
  - La regla de actualización niega cualquier cambio del marcador.
  - Con la valla activa, el servidor hace lo mismo.
- **Traslados cuna↔cama.** La ubicación del recién nacido entre la cuna de la madre y una cama
  propia conserva `clinicalEpisodeId`, que es el `encounterId` de Rayen (`rayenToPatientData.ts`,
  `neonatalPlacementReviewPlan.ts`). Buscar por episodio y `target` escondería el documento, y el
  relleno reescribiría el historial solo con la ventana de Rayen.
  - D4 busca solo por episodio, y en días marcados el guardado del servidor también.
  - Madre y recién nacido siguen separados porque sus ids son distintos.
- **Recuperabilidad.** Después de dividir, los documentos se sobrescriben con `set`. La copia
  adelgazada no lleva estos campos, las copias del día ya no los tienen y PITR está apagado. D11
  guarda el valor anterior en la copia de la corrida.
- **Versión de paridad.** Sin la vista combinada, todo campo movido saldría `mismatch` y el paso a
  `enforced` nunca pasaría. Con la vista combinada pero sin subir la versión, la evidencia anterior
  certificaría una paridad distinta. D13 cubre las dos cosas.
- **Idempotencia y `fieldContractVersion`.** Llevar la versión de cliente en `fieldContractVersion`
  haría `mismatch` los recibos v2 (`classifyIdempotency`). Un reintento con el mismo `mutationId`
  fallaría entonces con "mutationId was already used".
  - D7 usa un campo aparte, fuera del digest y de los recibos, y lo verifica después de la
    clasificación idempotente: un reintento de algo ya confirmado no escribe.
  - La versión 1 con campos movidos se rechaza en días marcados.
- **Objetivos históricos.** El lote y el parche pueden escribir el día anterior a la corrida (solo
  un administrador, solo `evaluationScores.cudyr`), con la autoridad leída del día fuente
  (`parseClinicalEnrichmentPayload`, `rayenLegacyClinicalWriteAuthority.js`).
  - D5 decide por la fecha objetivo.
  - Estos objetivos no llevan campos movidos, así que no marcan. Sobre un día ya marcado, el lote
    escribe desde el remoto y conserva el marcador.
- **Reglas al crear.** Si un cliente pudiera crear un día con marcador, podría falsificar un
  estado que solo pone el servidor: un día con un marcador inventado pasaría a modo dividido aunque
  el interruptor esté apagado. La revisión de seguridad automática lo detectó en P3.
  - La regla de creación niega el marcador (`createsWithoutClinicalDerivedLayout()`) para todo rol.
  - Las copias de IndexedDB o JSON sí pueden traerlo, porque el esquema del día deja pasar campos
    raíz desconocidos (`.passthrough()` en `src/schemas/zod/dailyRecord.ts`). Para que esas entradas
    no queden negadas para siempre en la cola, que nunca se purga, el cliente quita el marcador al
    crear o recrear un día, también al publicar la cola (P4).
  - Un día recreado así queda sin marcador. El servidor lo vuelve a marcar, con una generación
    nueva, en su primera escritura de un campo movido.
- **Restos al borrar un día.** El borrado (`dailyRecordDeletionService.ts`) pasa el día a la
  papelera y lo borra. Los documentos quedan, porque Firestore no borra en cascada y los clientes no
  pueden escribirlos.
  - D14: un día que recrea el servidor no los ve. Si el servidor sobrescribe uno, D11 lo guarda en
    la copia de la corrida.
  - Un día que recrea un cliente desde una copia llega sin marcador (regla de creación) y no ve los
    documentos de su vida anterior: tendrá generación nueva. Esos documentos siguen en Firestore, y
    un administrador puede recuperarlos.
- **Movimientos en la herramienta de personal.** Las fotos de altas, traslados y CMA (`originalData`)
  de días divididos ya no traen `vitalSignsHistory`. Superponer solo las camas activas perdería esos
  autores. D10 recorre todos los documentos del día.
- **Respaldos y exportación.** Sin cambios, los respaldos JSON de días divididos omitirían en
  silencio estos campos.
  - D10 agrega la sección `clinicalDerived`. Los PDF y Excel mensuales (`monthlyBackfillService.ts`)
    no usan estos campos.
  - El ADR pide un respaldo verificable antes de mover datos clínicos existentes. Los días antiguos
    no se migran, y lo que una escritura dividida saca del día queda en la copia de la corrida (D11)
    y en las exportaciones.
- **Clientes viejos y vuelta atrás.**
  - Un cliente v2 arma `vitalSignsHistory` desde el registro que leyó (`mergeReportVitals.ts`), sin
    las lecturas que ya están en el documento; si se aceptara, las perdería. D7 lo rechaza por
    solicitud, aunque la versión mínima publicada sea solo un aviso.
  - Sus guardados por callable quedan cubiertos por el servidor. La cola publica con `merge: true`,
    que no toca el marcador. Se niegan un reemplazo completo desde una copia anterior al marcado y
    una publicación que baje la revisión. Una entrada negada no se purga: cuando ese equipo carga la
    versión nueva, la publica con el marcador y `meta` del remoto (D9).
  - P5 se despliega con el interruptor apagado antes del despliegue que lo enciende. Después de
    activar, Functions nunca vuelve a una versión anterior a P5: escribiría valores embebidos que los
    documentos viejos taparían.
  - Restaurar en Netlify una publicación anterior baja la versión mínima publicada. Un cliente
    anterior a P4 no muestra el historial del documento y sus rellenos en días marcados se rechazan,
    sin pérdida.
- **Exenciones de índice.** Sin ellas, cada hoja de `vitalSignsHistory` y del checkpoint se indexa
  por separado: más costo por escritura y más almacenamiento. D12 las despliega antes de activar.
  El operador `apply-firestore-storage-policy.mjs` tiene una lista cerrada, y su prueba cuenta las
  escrituras (21 → 24).
- **Orden de lecturas en la transacción.** Firestore exige leer todo antes de la primera escritura,
  y el SDK rechaza lo contrario.
  - Parche: los documentos se leen antes de la copia de la corrida (`guardedHistoryRef`).
  - Lote: después del día y antes de `transaction.create(historyRef, …)`.
  - Guardado: los documentos del día anterior, antes de `applyTrustedClinicalCarryover` y del `set`
    del día.
  - La prueba de emulador lo cubre.
- **Semántica de la revisión.** Toda transacción del servidor que escribe un documento de episodio
  también escribe el día con `meta.revision + 1` (`buildNextMeta`, `buildClinicalEnrichmentMeta`) y
  `lastUpdated`, y anota esa revisión en `dayRevision`.
  - Las verificaciones por versión o por revisión siguen viendo cada cambio, y los listeners siguen
    recibiendo el día, más chico. El ahorro está en bytes por notificación, no en su número.
  - Las escrituras directas del cliente no suben la revisión. En días marcados tampoco la bajan
    (D9), y la regla de actualización niega bajarla. Si bajara, los documentos quedarían "adelante"
    del día y el relleno fallaría cerrado sin salida.
  - Solo cuentan para esa comparación los documentos de la generación vigente.
- **Lectura antes de desplegar las reglas.** El `deny` general bloquea la ruta nueva hasta el
  despliegue. Nada lee documentos sin un día marcado, y nada marca antes de la activación. Si
  igual llega una denegación, el lector la devuelve tipada: los lectores de mejor esfuerzo vuelven
  a lo embebido y el relleno falla cerrado.

## Plan de PR

| PR           | Contenido                                                                                                                                     | Necesita                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P1           | Medición por campo (#975)                                                                                                                     | hecho                                                          |
| P2           | Este diseño                                                                                                                                   | nada                                                           |
| P3           | Base de lectura: contrato gemelo, tipos y esquemas, reglas, exenciones, lector, superposición y servicio de lectura. Sin llamadas ni escritor | nada al fusionar; reglas y exenciones se despliegan al activar |
| P4           | Clientes: D9, D10, `CLIENT_RUNTIME_CONTRACT_VERSION` 3 y `clientRuntimeContractVersion` en los payloads de los callables                      | publicación del cliente                                        |
| P5           | Servidor tras el interruptor: D5–D8, D11, D13 y `BACKEND_RUNTIME_CONTRACT_VERSION` 3                                                          | despliegue de Functions con el interruptor apagado             |
| P6           | Activación: la variable en `deploy-functions.yml` y la versión mínima de cliente 3                                                            | los pasos del responsable (sección siguiente)                  |
| Aparte (D16) | El lote usa `buildSlimHistorySnapshot`, extraído a un módulo compartido                                                                       | despliegue de Functions, después de P5                         |

Qué lleva cada PR (pruebas siempre con datos sintéticos):

- **P3.**
  - Contrato gemelo `functions/lib/clinicalDerivedContract.js` y
    `src/services/storage/clinicalDerivedContract.ts`, con prueba de alineación.
  - Marcador en el tipo y el esquema del día, y tipo y esquema del documento.
  - Reglas: `clinicalDerived` con lectura `canReadClinicalData()` y escritura negada para todo rol,
    como `specialtyDecisions`. En `dailyRecords`, la actualización conserva el marcador y no baja la
    revisión de un día marcado; la creación niega el marcador. Matriz crítica, `firestore.rules`
    regenerado y pruebas de reglas.
  - Exenciones en `firestore.indexes.json`, con el operador y su prueba (21 → 24).
  - Pruebas de superposición (`null` gana, campo ausente usa lo embebido, generación o fecha ajena
    ignorada, id repetido, traslado cuna↔cama, pasaporte intacto) y del lector.
  - Docs: `FIRESTORE_STORAGE_COST_CONTROL.md` (exenciones) y `SYNC_CONCURRENCY_MODEL.md`
    (subcolección que solo escribe el servidor).
- **P4.**
  - Llamadas de D10, higiene de D9, versión de cliente 3 y `clientRuntimeContractVersion` en los
    payloads de los callables.
  - La versión 3 entra junto con las llamadas de D10 del relleno, nunca antes: D7 confía en ella, y
    un cliente v3 que arme `vitalSignsHistory` desde el día sin superponer pasaría la valla. Si P4
    se divide, la parte de D9 ya manda el campo, con la versión 2. Una prueba exige las dos cosas
    juntas.
  - Al crear o recrear un día, también al publicar la cola, el cliente quita el marcador.
  - `daily_record_size_observed` marca si el día está dividido.
  - Pruebas: el relleno superpone sus tres puntos y la base queda sin superponer; revisión
    adelantada con relectura y falla cerrada; merge de una copia local previa contra un remoto
    dividido; restauración de una versión anterior al marcado; ventana, creación del día,
    herramienta de personal y JSON.
- **P5.**
  - Módulos nuevos, enganches en los tres callables y `FieldValue` hacia las fábricas.
  - Pruebas de Functions y de emulador: división, revisión, rechazo del cliente viejo, copia
    embebida borrada, forma de `recordState`, día marcado a mitad de vida tras un guardado completo,
    copia de la corrida, arrastre desde un día anterior dividido, paridad v3, lote v1 rechazado,
    reintento idempotente y objetivo histórico.
  - Docs: `RUNBOOK_RAYEN_CLINICAL_ENRICHMENT_BATCH.md` (paridad v3 y copia de la corrida),
    `rayen-incremental-clinical-sync.md` (dónde vive el checkpoint) y
    `functions/lib/runtime/README.md` (la versión mínima es un aviso; la valla es la verificación
    por solicitud).
  - Precisiones de la implementación, para que el responsable las confirme:
    - D13: solo las entradas de un día marcado, o de un lote que lo marca al escribir, declaran
      `parityContractVersion` 3; un día sin marcador sigue en 2. Con la variable apagada la
      telemetría no cambia, y la evidencia se reinicia con el primer día dividido.
    - D7: en el lote, la valla corre después del no-op (una solicitud que no escribe responde
      `idempotent`) y rige también en `shadow` y en el día que la escritura marcaría. El guardado
      completo la exige al crear un día que marca si conserva campos movidos del propio cliente
      (sin la valla de Rayen).

## Activación

Solo la hace el responsable. P3, P4 y P5 ya están en `main`. Lo que pasa de verdad:

- Functions se despliega solo desde `main`, después de `ci-summary`, cuando el push toca
  `functions/` o `deploy-functions.yml` (`scripts/functionDeploymentSupport.mjs`). Si ese
  despliegue falla o se salta, el siguiente push a `main` lo reintenta. Por eso fusionar P6 es
  activar el servidor: la fecha de inicio llega con ese despliegue.
- Netlify publica cada fusión a `main` en unos minutos, antes de que termine el CI, salvo que la
  publicación automática del sitio esté bloqueada; entonces se publica a mano. El día de inicio
  debe estar publicado P4b o posterior (contrato 3); con un cliente anterior, cada relleno de un día
  dividido falla cerrado con `clinical_derived_client_outdated`.
- Nunca desplegar Functions desde un portátil: `functions/.env.*` está en `.gitignore` y solo lo
  escribe el CI, así que se perderían el interruptor y las dos banderas de Jev. Un despliegue de
  emergencia va por `workflow_dispatch` de `deploy-functions.yml`.

Pasos:

1. Desplegar las reglas generadas (`firestore.rules`) de `main` (hecho el 2026-10-24).
2. Aplicar las exenciones con `scripts/apply-firestore-storage-policy.mjs` en `hhr-pruebas` y en
   todo proyecto donde se encienda la división: primero sin `--apply` para ver el plan, luego con
   `--apply`, como indica `FIRESTORE_STORAGE_COST_CONTROL.md`. Comprobar las tres nuevas. Necesita
   `gcloud`. Nunca `firebase deploy --only firestore:indexes`: activaría también el TTL de
   `specialtyAiRequests` que el script excluye. Sin las exenciones nada se rompe, pero cada hoja del
   checkpoint y cada arreglo de signos se indexa. Hecho en `hhr-pruebas` el 2026-10-24.
3. Comprobar en Actions que `validated-functions-deployment` terminó bien para P5 o posterior. Sin
   la variable, el relleno y el lote siguen como antes. Hecho el 2026-10-24 (`3fe595547`).
4. Comprobar que el deploy publicado en Netlify es de P4b (#1004) o posterior, y publicarlo si no.
   Sin días marcados no lee nada nuevo. Hecho el 2026-10-24 (`3fe595547`).
5. Fusionar P6 después de 2 y 4, fuera del tren automático, con una fecha de inicio al menos dos días
   (hora de Rapa Nui) después de la fusión. El CI despliega Functions con
   `HHR_CLINICAL_DERIVED_SPLIT_FROM=<fecha>`. En `hhr-pruebas` la escribe `deploy-functions.yml`;
   otro proyecto necesita su propio `functions/.env.<proyecto>`, o la división queda apagada. Una
   prueba (`clinicalDerivedSplitSwitchWorkflow.test.ts`) comprueba que el servidor lee esa fecha:
   cualquier otro valor la deja apagada sin error.
6. El mismo día, comprobar que el deploy publicado es el de la fusión de P6 o posterior (publicarlo
   si la publicación automática está bloqueada) y que `/.netlify/functions/runtime-contract`
   responde `minSupportedClientRuntimeContractVersion` 3: las pestañas viejas ven el aviso de
   actualización. Desde 24 horas antes de la fecha de inicio hasta el día siguiente, no publicar
   otro cliente; con la publicación automática activa, eso significa no fusionar a `main` cambios
   que lleguen al cliente.
7. El día de inicio, varias veces (la vista de telemetría de Functions carga las últimas 500 filas):
   - en `dailyRecordWriteAuthority`, un solo `marking` por fecha, cero rechazos `clinical_derived_*`
     y `EmbeddedEpisodes` cerca de 0;
   - `daily_record_size_observed` con la marca de día dividido, `vitalsHistoryBytes` y
     `checkpointBytes` bajando hacia 0 y un tamaño acorde a la estimación;
   - corridas del relleno sin `clinical_derived_client_outdated` de clientes actuales ni fallas de
     carga por la superposición;
   - en `shadow` o `enforced`, evidencia del contrato v3 en la tarjeta del lote;
   - la ventana de signos vitales con el historial completo.
8. El día siguiente, después de la copia de las 08:00: la ventana de signos de un episodio dividido
   trae el historial arrastrado, y no hay lecturas degradadas al crear el día.

Volver atrás:

- Apagar es un PR que solo mueve la fecha hacia adelante o la quita; al fusionarlo, el CI redespliega
  Functions. Los días ya marcados siguen divididos y funcionando, y se corrige hacia adelante.
- Cliente: corregir hacia adelante. Después del primer día marcado, nunca restaurar en Netlify un
  deploy anterior a P4b.
- Nunca volver Functions a una versión anterior a P5: la versión mínima de backend 3 hace fallar
  ese revert en `check:runtime-contracts`. Nunca retirar la regla de lectura de `clinicalDerived`.
  Nunca borrar documentos de episodio ni marcadores, ni purgar colas.
