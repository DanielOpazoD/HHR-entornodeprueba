# Sincronización clínica incremental Eloísa → HHR

## Objetivo

La sincronización trata a Eloísa como una fuente de hechos clínicos estables, pero corregibles. HHR
conserva su censo como proyección local y sólo persiste un cambio cuando un hecho nuevo o una
corrección altera el resultado clínico. Repetir una sincronización con la misma información debe ser
un _no-op_ por paciente.

El checkpoint incremental comprende signos vitales, Braden/Downton y evidencia de actividad de
Enfermería / TENS. El llenado clínico de la misma corrida también trata dispositivos invasivos,
CUDYR (del día y D-1), la verificación de arrastre, el archivo CUDYR y la propuesta de dotación,
pero esos pasos no usan checkpoint. No introduce _event sourcing_, infraestructura nueva ni
escrituras paralelas.

## Identidad, checkpoint y correcciones

- Cada paciente/episodio guarda un `clinicalSyncCheckpoint` por fuente (`vitals`, `scales`,
  `staffing`). Al sembrar el día siguiente se elimina y se reconstruye en la primera verificación.
- Dónde vive depende del día (fase 1a, `DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`):
  - En un día sin marcador `clinicalDerivedLayout`, dentro del registro del día, como siempre.
  - En un día marcado, junto con `vitalSignsHistory`, en
    `dailyRecords/{fecha}/clinicalDerived/{clinicalEpisodeId}`, un documento por episodio que solo
    escribe el servidor. Un episodio que aún no tuvo una escritura dividida conserva su copia
    embebida y los lectores combinan ambos campo por campo.
  - Solo el servidor marca un día: en su primera escritura de un campo movido con fecha igual o
    posterior a `HHR_CLINICAL_DERIVED_SPLIT_FROM`, o al crear un día con fecha igual o posterior.
- El contrato tiene versiones independientes de esquema y huella. Una versión desconocida se ignora
  y se reconstruye desde la fuente; nunca bloquea la sincronización.
- Si Eloísa entrega identidad estable, ésta identifica el hecho: `encounterEventId` en signos
  vitales y código + evento + orden en escalas. Si no existe, como en la evidencia de dotación, se
  usa una huella determinista del contenido como alternativa.
- El checkpoint guarda identidades y contenidos como hashes (FNV-1a de 32 bits: deduplican, no son
  una protección criptográfica) y marcas de agua como identificadores de evento o fecha/hora. No
  guarda nombres, RUT, profesionales ni valores clínicos.
- El mismo identificador con igual huella es duplicado; con distinta huella es una corrección. La
  corrección reemplaza la proyección anterior y conserva la trazabilidad normal del censo.
- Cada fuente conserva una ventana acotada de 128 hechos recientes. Es el solapamiento que permite
  reconocer reintentos y correcciones tardías sin crecimiento ilimitado.

## Escrituras y consistencia

### Fecha y hora de signos vitales

HHR y la extensión resuelven el campo clínico de la toma en UTC cuando no declara offset,
y muestran fecha y hora del mismo instante en `Pacific/Easter`. Una toma retrospectiva
conserva su hora clínica, aunque se haya registrado después.

Si ese campo apunta a un instante posterior al sello resoluble del propio registro
(`effectiveWhen`, incluyendo revisiones de campos), es contradictorio: se usa el sello
del registro con offset, que en el incidente observado coincide con el historial original.
Esto no demuestra la hora real de una toma en todos los casos; es una recuperación del
registro fuente, no una corrección de Eloísa. Sin un sello con offset no se inventa una
corrección. No se usa el reloj del equipo ni una resta horaria fija.

Ambos lectores ordenan por el instante resuelto y sólo desempatan por identificador de
evento. Al reimportar, HHR reemplaza la hora anterior del mismo `sourceEventId` sin crear
otra toma. La recuperación requiere releer la fuente; no modifica datos en Eloísa.

- Las lecturas remotas mantienen concurrencia acotada: hasta cuatro por cada cola independiente
  (dispositivos, historial, formularios y paquete clínico); cada paquete lee dispositivos, historial
  y formularios en paralelo dentro de la extensión.
- Las escrituras del censo se serializan para evitar conflictos de versión entre pacientes de una
  misma ejecución. La política guardada con la corrida elige un solo escritor: `off` escribe por
  paciente; `shadow` escribe por paciente y compara con un lote en simulación; `enforced` envía
  un lote atómico (`applyRayenClinicalEnrichmentBatch`) por día de censo, el del día y, para CUDYR
  histórico, uno acotado hacia D-1, con un reintento que conserva el `mutationId`. Nunca cambia a
  escrituras por paciente a mitad de la corrida. Si la política no puede confirmarse, no escribe y
  deja un reintento.
- Cada corrida deja como máximo una copia histórica fija por `runId` y día. Por paciente, el
  servidor crea `history/rayen-{runId}` sólo si no existe, aunque el cliente la vuelva a pedir tras
  un fallo; el lote crea su copia `rayen-clinical-…` sólo cuando trae parches clínicos. En un día
  marcado la copia guarda además, en `clinicalDerivedPrevious`, el checkpoint y el historial de
  signos vitales de cada episodio antes de su primera escritura en la corrida; los parches
  siguientes de la misma corrida solo agregan los episodios que faltan.
- Una ejecución sin cambios produce cero parches por paciente; sólo puede actualizar el evento de
  auditoría agregado. Excepciones acotadas: un parche sólo de checkpoint en la primera lectura
  confirmada o cuando se mueven las marcas de la validación completa diaria, y la reparación de
  escalas duplicadas ya persistidas.
- La ausencia de un hecho en una lectura parcial o fallida nunca se interpreta como eliminación.
- CUDYR, D-7, zona `Pacific/Easter`, doble fuente de escalas, vínculo madre-cuna y trazabilidad de cama
  mantienen sus reglas existentes.

## Destilación del flujo

La sincronización conserva sólo los pasos que agregan evidencia o protegen consistencia:

1. captura atómica del censo de Ficha Médico y el reporte administrativo de Gestión de Camas;
2. conciliación del censo y consulta de evidencia individual únicamente cuando una cama, un egreso o
   un ingreso nocturno lo requiere;
3. aplicación del cambio confirmado y enriquecimiento clínico independiente;
4. persistencia granular sólo de hechos nuevos o corregidos.

Dentro de una ejecución, las consultas repetidas del mismo informe oficial de trazabilidad se
coalescen por `ENC_ID`. Una respuesta válida puede alimentar tanto la reconstrucción histórica como
la verificación del ingreso nocturno sin volver a descargar el PDF. La caché vive sólo durante esa
sincronización y descarta respuestas vacías, errores y excepciones para conservar el reintento. No se
comparte entre ejecuciones: una sincronización posterior siempre puede observar movimientos nuevos.

No se eliminan las lecturas completas de signos vitales, escalas o actividad clínica porque Eloísa no
ofrece todavía un cursor remoto que permita demostrar que una lectura parcial contiene correcciones
y elementos archivados. Tampoco se paralelizan escrituras del mismo censo ni se eleva la concurrencia
remota sin evidencia de capacidad; ambos atajos reducen tiempo a costa de consistencia o estabilidad.

## Reanudación y recuperación

- Cada pestaña mantiene en memoria una sola ejecución clínica activa y, como máximo, una pendiente
  **por fecha de censo** (`enqueueLatestRayenClinicalFill`). Las solicitudes con la misma clave
  (fecha + `runId` + inicial o reintento) comparten resultado. Una clave nueva sólo reemplaza la
  pendiente de su propia fecha, sin token de reintento para la reemplazada, y nunca interrumpe la
  activa. Las fechas pendientes se atienden por orden de llegada; una ejecución que esperó vuelve a
  leer el registro y se descarta si su `runId` ya no es el vigente.
- Un evento de censo en estado `applied` se reanuda desde «Reintentar información clínica» sin
  volver a capturar ni aplicar el censo completo; sólo relee los episodios y fuentes que fallaron.
- No hay un disparador manual de reconciliación completa. Un checkpoint de versión desconocida se
  ignora y se reconstruye solo. La validación completa del historial (al menos 14 días y siempre
  hasta dos días antes de la fecha del censo) se ejecuta automáticamente como máximo una vez cada
  24 h después de una validación certificada, o 15 min después de un intento no confirmado.

## Telemetría y datos del evento

El evento de sincronización registra contadores agregados: recibidos, nuevos, duplicados,
correcciones, escrituras y copias históricas. En modo lote, `patientWrites` cuenta lotes confirmados
(normalmente 1), no pacientes. Con ellos el historial distingue una ejecución útil de una repetición
idempotente. Además guarda objetivos, tiempos y evidencia del lote y, para facilitar la resolución
de problemas, el detalle de cada incidencia: cama, episodio y fecha del censo, nombre y documento
del paciente (en las lecturas clínicas fallidas, sólo si el episodio identifica a un único
paciente) y el motivo de los conflictos estructurales. En la evidencia de dotación excluida
guarda nombre y rol del personal. No guarda valores clínicos, excepciones crudas ni credenciales.

## Estrategia de activación

La fusión incremental se valida contra la proyección completa mediante pruebas de regresión: mismo
resultado clínico, repetición sin escrituras, corrección tardía convergente, fallas parciales sin
borrado y una sola copia histórica por ejecución. Los endpoints actuales no ofrecen un cursor remoto
confiable; por eso esta etapa reduce primero el procesamiento y las escrituras observadas en HHR sin
recortar de forma insegura la lectura de la fuente. Un filtro remoto sólo debe habilitarse cuando el
contrato de Eloísa permita demostrar equivalencia con la lectura completa.
