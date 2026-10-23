# Diseño fase 1: datos clínicos derivados fuera del registro del día

**Estado:** Propuesta (2026-10-23), pendiente de decisión del responsable. No hay código que la
implemente.
**Ámbito:** fase 1 de `ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.md`.
**Relacionado:** `ADR_DAILY_CENSUS_CLINICAL_DATA_OWNERSHIP.md`,
`ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`, `rayen-incremental-clinical-sync.md`.

## Qué se mueve y qué no

Según los comentarios medidos del servidor, cada episodio ocupado (cama o cuna clínica) lleva en el
día unos 17 KB de `clinicalSyncCheckpoint`, unos 13 KB de `vitalSignsHistory` y unos 7,5 KB de
`evaluationScores`. El registro del día se estima en unos 0,5 MB, es decir, unos 13 episodios.

| Fase                                 | Campos                                        | Se queda en el día                                                                                                     |
| ------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1a                                   | `clinicalSyncCheckpoint`, `vitalSignsHistory` | —                                                                                                                      |
| 1b, solo si la medición lo justifica | `evaluationScores.history`                    | `cudyr`, `braden`, `downton`, `vitalSigns`, `clinicalCarryover`: los leen CUDYR, sus impresiones y los chips del censo |
| Aparte                               | diagnósticos de `rayenSyncHistory`            | la autoridad de cada corrida, porque el servidor la verifica dentro de la misma transacción del día                    |

La fase 1a reduciría unos 30 KB por episodio: de unos 0,5 MB a unos 0,11 MB con 13 episodios
(−78 %). Eso achica en la misma proporción:

- cada descarga del día completo;
- las copias de historial y de conflicto;
- las fotos de movimientos y el correo del mes.

Los números por campo de `daily_record_size_observed` (#975) deben confirmar esta estimación antes
de seguir.

## Dónde

`hospitals/hanga_roa/dailyRecords/{fecha}/clinicalDerived/{clinicalEpisodeId}`: un documento chico
por día y episodio.

- Todo lector actual trabaja sobre un solo día, y el dato es "a esa fecha":
  - el checkpoint se reinicia cada día;
  - los signos vitales se copian a cada día.

  Un documento por toda la estadía cambiaría lo que se ve en días pasados.

- La clave es el episodio, no la cama. Madre y recién nacido tienen documentos distintos, y mover
  de cama no toca el documento. Ningún documento de identidad se normaliza, así que un pasaporte
  sigue siendo pasaporte.
- Hay un precedente: `specialtyDecisions` ya es una subcolección del día que solo escribe el
  servidor (`firestore.rules`, lectura con `canReadClinicalData`, escritura `false`).

## Quién escribe

Solo el servidor (Functions, Admin SDK). Las escrituras clínicas de la importación ya pasan por
Functions aun en modo `client_only`:

- todo parche con `rayenClinicalWriteGuard` va a `patchDailyRecordWithClinicalAuthority`;
- el lote es el callable `applyRayenClinicalEnrichmentBatch`.

Ningún cliente necesita permiso de escritura en la ruta nueva.

## Convivencia sin migración

- **Días anteriores:** nunca se tocan.
- **Días divididos:** el servidor divide solo los días desde una fecha de inicio configurada y
  marca el día con un marcador que no se borra. Volver atrás es mover esa fecha hacia adelante; los
  días ya divididos siguen funcionando.
- **Lectura campo por campo:**
  - si el documento del episodio tiene el campo, gana ese valor (también si es `null`);
  - si no, se usa la copia del día.

  La creación del día, los clientes viejos y las restauraciones de conflicto pueden devolver copias
  viejas al día, y con esta regla nunca ganan.

- **Revisión del día:** toda escritura en un documento de episodio sube la revisión del día en la
  misma transacción, para que las verificaciones de versión sigan siendo correctas.
- **Lectores:** la importación superpone los documentos del episodio en sus dos puntos de carga
  (`loadFreshClinicalRecord` y la lectura fresca de `patchFreshClinicalRecord`) y nunca guarda el
  objeto superpuesto. La ventana de signos vitales lee el documento al abrirse. No se agregan
  listeners.

## Despliegues que hace el responsable

1. Reglas de Firestore: la ruta nueva en solo lectura para el cliente, más las exenciones de índice.
   El `deny` general la bloquea hasta entonces, y el lector del cliente vuelve a la copia embebida
   si recibe `permission-denied`.
2. Functions: el callable por lotes, el parche con guarda y la creación del día en el servidor
   (arrastre de signos vitales).
3. Subir `MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION` antes de activar la división. Así las
   versiones viejas se actualizan, y el servidor rechaza sus escrituras en días divididos.

## Plan de PR

| PR     | Contenido                                                                                                                                | Necesita                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1      | Medición por campo (#975)                                                                                                                | nada                    |
| 2      | Contrato compartido cliente/servidor con prueba de paridad, reglas de solo lectura y lector con respaldo; todavía nada escribe           | despliegue de reglas    |
| 3      | El cliente lee ambos formatos: importación, ventana de signos vitales, creación del día y herramienta de personal                        | publicación             |
| 4      | El servidor divide los campos tras un flag apagado por defecto                                                                           | despliegue de Functions |
| 5      | Activar la división para días nuevos y subir la versión mínima de cliente                                                                | decisión y despliegue   |
| 6      | `evaluationScores.history`, solo si la medición lo justifica                                                                             | despliegue              |
| Aparte | El lote del servidor guarda una copia de historial completa: cambiarla por `buildSlimHistorySnapshot`, como ya hace el parche con guarda | despliegue de Functions |

## Decisiones abiertas

- **Ruta:** la propuesta (`dailyRecords/{fecha}/clinicalDerived/{episodio}`) o
  `clinicalEpisodes/{episodio}/derived/{fecha}`. La segunda requiere consultas de grupo de
  colecciones.
- **Modo real del enriquecimiento:** cuál es hoy (`clinicalBatchMode` off, shadow o enforced).
  Decide cuál escritor está activo; responder desde la operación, no con una lectura de producción.
- **Interruptor:** una fecha en una variable de entorno (cambia solo con un redespliegue) o un
  documento de configuración (requiere cambiar reglas).
- **Sin conexión:** cargar los documentos de episodio al abrir el detalle o precargar los del día
  una vez por sesión.
- **Exportación JSON y respaldo verificable:** si deben incluir los campos movidos de días
  divididos. El ADR exige un respaldo antes de mover datos clínicos.
