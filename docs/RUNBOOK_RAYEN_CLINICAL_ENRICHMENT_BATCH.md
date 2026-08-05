# Rollout de enriquecimiento clínico transaccional Rayen

## Objetivo

Reducir las K hidrataciones, verificaciones y escrituras clínicas por paciente a un lote acotado
por sincronización, sin cambiar la captura de Eloísa ni relajar la autoridad del censo.

El callable `applyRayenClinicalEnrichmentBatch` admite exclusivamente dispositivos, escalas,
signos vitales, sus historiales y `clinicalSyncCheckpoint`. Los cambios clínicos y los avances del
checkpoint viajan separados: un lote que solo avanza el checkpoint no crea una versión clínica
idéntica. Verifica en una transacción la fecha, revisión, cama, `clinicalEpisodeId` y cuna RN antes
de escribir. Cada `runId` genera como máximo un snapshot histórico por día de censo afectado y
`runId`/`mutationId` hacen el reintento idempotente. El `runId` es el identificador de la
sincronización estructural que originó el enriquecimiento y se conserva en todos sus lotes; el
`mutationId` identifica cada mutación acotada y se conserva entre reintentos de transporte.

## Modos

- `off`: conserva la semántica compatible de escrituras por paciente. Una vez migrada la política
  a esquema v2, cada parche clínico pasa por el callable de autoridad con el `runId`, la revisión y
  la política congelados; el navegador no recupera escritura clínica directa.
- `shadow`: las escrituras por paciente continúan apenas quedan listas mediante esa misma autoridad
  guardada; al final se observa el mismo
  lote en backend con `dryRun`. Se conserva para diagnóstico controlado, no como ruta operativa
  habitual. Un fallo del observador no revierte la persistencia clínica y la llamada queda acotada
  a 20 s.
- `enforced`: el callable aplica el lote. Los errores transitorios tienen un reintento idempotente,
  pero nunca hacen fallback porque su resultado puede ser ambiguo. Un callable ausente, un lote que
  excede el límite o una respuesta sin paridad confirmada dejan los datos pendientes y reintentables.
  Rechazos de autenticación, revisión, episodio o allowlist se muestran como conflicto y tampoco
  hacen fallback silencioso. Solo se activa explícitamente después de la promoción operativa basada
  en el gate de paridad.

Esta política define únicamente quién escribe el enriquecimiento clínico de Rayen. Cambiarla a
`off` o `shadow` nunca rebaja por sí solo la autoridad independiente configurada para el resto del
censo (`VITE_DAILY_RECORD_AUTHORITY_MODE`).

El cliente resuelve uno de estos modos una sola vez al iniciar cada ejecución y lo traduce a una
estrategia discriminada: escritura inmediata (`off`), escritura inmediata con observación posterior
(`shadow`) o autoridad diferida al lote (`enforced`). El runner no admite combinar observador y
autoridad en una misma ejecución; así se conserva un único propietario de cada escritura clínica.

Los dos modos —importación estructural y persistencia clínica— viven en una única política global de
Firestore, confirmada por servidor y con revisión monotónica. Cada ejecución congela ambos valores y
su revisión en `rayenSyncHistory`. Una política ausente, inválida, pendiente o servida sólo desde
caché bloquea el inicio de nuevas sincronizaciones: nunca se interpreta como un rollback. Un
documento v1 confirmado por servidor puede leerse para mostrar el estado seguro `off`, pero deja
la sincronización bloqueada hasta que un administrador ejecute su migración atómica a v2 desde
Configuración; la migración conserva el modo estructural, mantiene `off` y avanza la revisión.
Si el documento no existe, un administrador debe usar **Inicializar política segura** antes de la
primera sincronización.
La fase clínica vuelve a leer el modo congelado desde el evento del `runId`; si ese evento aún no
está disponible, deja el lote pendiente para reintento y tampoco activa escrituras por paciente.
El callable vuelve a verificar, dentro de la misma transacción, el documento global y el evento del
`runId`: modo estructural, modo clínico y revisión deben seguir coincidiendo. Una modificación de la
política durante una ejecución invalida ese lote y exige iniciar una sincronización nueva.
Mientras `off` o `shadow` conservan la semántica por paciente, cada parche clínico comprueba esa
misma política y revisión dentro de la transacción remota antes de actualizar la caché local. Tras
la migración a esquema v2 esa transacción pertenece siempre al callable autenticado. Si un
administrador promueve a `enforced` durante una ejecución antigua, los parches restantes fallan
cerrado y no entran en la cola offline; una nueva ejecución adopta al escritor por lote.
Las ejecuciones antiguas congeladas con la política segura implícita `preview/off`, revisión 0,
pueden terminar mientras el documento global siga ausente. Inicializar la política cierra también
esa compatibilidad y obliga a reiniciar cualquier ejecución pendiente.
En `enforced` no se ejecuta el escritor individual ni siquiera para CUDYR histórico. Las
correcciones de D−1 viajan en un segundo lote acotado hacia ese día; el callable verifica la cama y
episodio del día destino, y obtiene la autoridad exclusivamente del `runId` congelado en el día
origen. No se permiten fechas más antiguas ni un fallback individual.
En `off` y `shadow`, la compatibilidad histórica permite exclusivamente CUDYR canónico y exige rol
administrador. El callable ignora cualquier solicitud cliente de omitir historial: conserva como
máximo un snapshot determinista por `runId` y devuelve la revisión remota confirmada para que
IndexedDB nunca sustituya ese estado con metadatos anteriores.
El evento autoritativo congela también `sourceDate`. Todo lote declara obligatoriamente
`authorityDate`, que debe coincidir con esa fecha y con el documento que contiene el evento. Así un
cliente no puede reutilizar un `runId` de otro día para escribir un censo histórico. Sólo un
administrador puede autorizar un destino distinto del día origen; el reintento exacto de una
mutación ya confirmada devuelve su recibo antes de revalidar el estado clínico mutable.

Desde que la política global alcanza el esquema v2, los guardados estructurales completos conservan
desde Firestore los campos clínicos propiedad del backend, incluso si el modo vuelve a `off` o
`shadow`. La preservación identifica al paciente o cuna por `clinicalEpisodeId`, no por cama, para
tolerar traslados concurrentes. Un episodio nuevo que aún no fue aceptado por la autoridad clínica
no puede introducir esos campos desde el navegador.

## Secuencia operativa

1. Desplegar primero Firebase Functions y confirmar que el workflow `Deploy Firebase Functions`
   termina correctamente. Requiere el secreto
   de repositorio `FIREBASE_SERVICE_ACCOUNT_HHR`, usa Node 22 y verifica después del despliegue que
   `applyRayenClinicalEnrichmentBatch` exista realmente en `hhr-pruebas`.
2. Desplegar después la aplicación web con contrato runtime v2. Durante esta ventana el backend v2
   todavía acepta clientes runtime v1 para permitir el orden Functions → web sin indisponibilidad;
   la web v2, en cambio, exige backend v2 y por eso nunca debe publicarse primero.
3. Confirmar que callable y web v2 responden, y sólo entonces migrar la política global a esquema
   v2 desde Configuración. Esta migración activa el cerco irreversible de escritura clínica en
   Firestore: pestañas y outboxes antiguos ya no pueden escribir campos clínicos directamente,
   aunque el modo operativo vuelva después a `off` o `shadow`. Recargar las pestañas v1 que sigan
   abiertas. Elevar en un despliegue posterior el piso del backend a cliente v2 es un endurecimiento
   operativo independiente; no es requisito para activar el cerco.
4. Antes de una nueva promoción o después de cambios en el contrato, desplegar `shadow` durante
   varias ejecuciones y al menos dos turnos; revisar
   `functionsTelemetry` con
   `service = rayenClinicalEnrichment`.
   Cada entrada declara `parityContractVersion`; el gate usa solo la versión más reciente y conserva
   las anteriores como auditoría. Un cambio de versión reinicia las cuatro ejecuciones y las ocho
   horas exigidas.
5. Usar el gate **Lote clínico transaccional** del panel técnico. Para recomendar `enforced` exige
   al menos 4 ejecuciones shadow coincidentes, 8 horas entre la primera y última evidencia, ninguna
   paridad ausente y cero señales bloqueantes.
6. Exigir paridad `matched`, cero rechazos inesperados de `permission-denied`,
   `failed-precondition` y `aborted`, y ausencia de degradación clínica.
7. Comparar `targetCount`, `fieldCount`, duración y cobertura con el flujo actual. La telemetría no
   contiene RUT, nombres, camas, ENC_ID ni valores clínicos.
8. En Configuración → Integraciones, activar explícitamente **Lote transaccional**; no existe
   promoción automática. Verificar en el historial que el run declara `lote enforced` y la revisión
   esperada. Vigilar reintentos y volver explícitamente a **Compatibilidad por paciente** (`off`)
   ante errores sostenidos.

## Incrementalidad de lectura y escritura

- El cliente compara el contenido clínico canónico y excluye del lote todo paciente sin un cambio
  clínico efectivo ni avance de checkpoint.
- Un target que solo cambia `clinicalSyncCheckpoint` se persiste en la misma transacción, pero no
  cuenta como parche clínico ni genera snapshot en `history/`. El cliente lo envía en la sección
  `checkpoints`, no duplicado dentro de `patches`.
- Signos vitales, escalas y actividad de dotación conservan identidades/fingerprints acotados y un
  watermark por fuente. La ruta histórica actual de Ficha Médico no acepta un watermark explícito:
  se mantiene su ventana adaptativa normal y se realiza como máximo una revalidación completa cada
  24 horas. La ventana base es de 14 días y se extiende cuando sea necesario para incluir la fecha
  del censo histórico solicitado, hasta el máximo operativo de 180 días del endpoint. Una fecha que
  exceda ese límite no se marca como revalidación completa.
- Para el censo clínico vigente, dispositivos usa primero la respuesta JSON estructurada de Ficha
  Médico. Los censos históricos conservan el PDF fechado como autoridad; el PDF también permanece
  como fallback de compatibilidad cuando el endpoint JSON no está disponible.
- El contador `cacheHits` incluye la reutilización intrarrun del único resultado CUDYR masivo. Para
  `K` episodios elegibles registra `K - 1` lecturas individuales evitadas solo cuando esa lectura
  compartida fue autoritativa; no simula caché cuando el origen falla.

## Invariantes

- Máximo 32 pacientes/cunas y 500 KB por lote; censo y snapshot se rechazan antes de escribir si
  su representación supera 900 KB, dejando margen para el overhead de Firestore. `shadow` puede
  dividir la observación porque nunca persiste. En `enforced`, si la ejecución completa requiere
  varios fragmentos, el cliente falla antes de la primera mutación: así el lote aplicado conserva
  atomicidad y nunca deja un enriquecimiento clínico parcial.
- Una sola lectura del documento de censo destino dentro de una transacción; el lote histórico
  añade únicamente la lectura del día origen que contiene el evento autoritativo del `runId`.
- Coincidencia exacta de `clinicalEpisodeId` en la cama o cuna indicada.
- Coincidencia exacta entre la política global v2 confirmada por servidor y la política inmutable
  capturada por el `runId`; el callable no confía en el modo enviado por el navegador.
- Coincidencia exacta entre `authorityDate`, el `sourceDate` inmutable del evento y la fecha del
  documento que lo contiene. Un lote histórico requiere además rol administrador.
- Cliente y backend usan contrato runtime v2. La web exige backend v2; el backend acepta
  temporalmente cliente v1 sólo para permitir el despliegue ordenado. La seguridad anti-rollback no
  depende de ese piso temporal: una política v2 bloquea de forma permanente las escrituras clínicas
  directas del navegador. Una política v1 no inicia ejecuciones y requiere una migración
  administrativa explícita y atómica antes de congelar un nuevo `runId`.
- El escritor compatible por paciente confirma atómicamente esa revisión mediante el callable antes
  de cada parche y persiste primero en Firestore. Una escritura rechazada por cambio de política
  nunca queda en IndexedDB ni en el outbox para ser reproducida después de la promoción.
- En `enforced`, coincidencia obligatoria de `lastUpdated` y de `meta.revision` cuando el cliente la
  conoce. `shadow` no bloquea por versión porque no escribe y observa el estado posterior al flujo
  establecido.
- Un snapshot determinista y de creación exclusiva por `runId`; reutilizar un identificador antiguo
  no puede sobrescribir su historia aunque el recibo ya haya salido de la ventana de 16 ejecuciones.
- Un guardado estructural completo no puede modificar campos clínicos propiedad del backend una vez
  activado el esquema v2; se preservan por episodio incluso si el paciente cambió de cama.
- Un conflicto de versión reconstruye desde el censo vigente cualquier valor canónico derivado del
  registro (incluido CUDYR histórico) antes del único reintento; nunca reutiliza un objeto de scores
  obsoleto que pueda borrar una escala concurrente.
- Ningún dato demográfico o valor clínico en telemetría.
- Los desacuerdos de `shadow` registran solo conteos agregados por sección (dispositivos, escalas,
  signos vitales y checkpoint), nunca nombres de campos internos, camas ni identificadores clínicos.

## Rollback

Un administrador selecciona **Compatibilidad por paciente** (`off`) en Configuración → Integraciones
y espera la confirmación del servidor antes de iniciar otra sincronización. No requiere migración y
no desactiva el cerco del esquema v2: las escrituras compatibles siguen pasando por el callable con
la política congelada. Los recibos son metadatos acotados y los campos clínicos conservan exactamente
el mismo esquema que el flujo por paciente. No se debe modificar una variable local para simular el
rollback ni degradar el documento de política a v1.
