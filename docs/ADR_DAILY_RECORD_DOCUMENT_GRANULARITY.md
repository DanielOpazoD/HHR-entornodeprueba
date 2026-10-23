# ADR: Granularidad del registro diario

**Estado:** Aceptada (2026-10-23) como dirección. Cada fase se decide con mediciones propias.
**Ámbito:** `dailyRecords/{fecha}` · sincronización · historial · importación clínica desde la extensión.
**Relacionado:** `ADR_DAILY_CENSUS_CLINICAL_DATA_OWNERSHIP.md`, `ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`,
`ADR_DAILY_RECORD_RUNTIME_PATH.md`, `ADR_CONFLICT_VERSION_RECOVERY.md`.

## Contexto

Cada día del censo es un solo documento Firestore. El servidor lo estima en unos 0,5 MB. Ese documento
es a la vez la unidad de almacenamiento, sincronización, conflicto, historial y transporte:

- Firestore entrega el documento completo a cada equipo suscrito cada vez que cambia.
- Cada guardado desde el navegador sube además una copia completa del estado previo a
  `dailyRecords/{fecha}/history`. Ningún código lee esas copias; la restauración de versiones usa
  `conflictSnapshots/`. La medición del 13-10-2026 registró 12.727 copias sin vencimiento en
  `hhr-pruebas`.
- Firestore rechaza documentos de más de 1 MiB. Solo el enriquecimiento clínico del servidor
  comprueba un tope (900 KB). Las demás escrituras no comprueban el tamaño.
- Cada cama ocupada arrastra unos 38 KB de datos derivados que escribe la sincronización clínica
  (`clinicalSyncCheckpoint`, `vitalSignsHistory`, `evaluationScores`). El día también incluye el
  registro de sincronización `rayenSyncHistory`.
- La extensión y el personal escriben el mismo documento. Para no pisarse existen compuertas de
  frescura, revisiones y copias de conflicto, y todas agregan esperas y reintentos.

## Decisión

Avanzar por fases hacia documentos chicos con un solo dueño. La identidad clínica es el episodio, no la
cama (`ADR_DAILY_CENSUS_CLINICAL_DATA_OWNERSHIP.md`). La verdad del censo sigue el contrato vigente
(`ADR_DAILY_CENSUS_TRUTH_CONTRACT.md`).

| Fase | Cambio                                                                                                                                                                      | Condición para avanzar                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 0    | Medir tamaño y versiones (`daily_record_size_observed`). Historial acotado (como máximo una copia por hora y equipo). Lecturas acotadas. Correo del censo sin subir el mes. | Una semana de mediciones.                                                              |
| 1    | Sacar del día los datos derivados de la sincronización clínica y el registro de sincronización embebido, a documentos por episodio que solo escribe la importación.         | La medición muestra que esos datos pesan lo suficiente o que hay días cerca de 700 KB. |
| 2    | Un documento por episodio y día para los datos clínicos editables. La cabecera del día conserva turnos, firmas y movimientos.                                               | La fase 1 midió menos tamaño y menos conflictos, y existe un respaldo verificable.     |
| 3    | Historial como registro de cambios (auditoría) en vez de copias completas.                                                                                                  | Fase 2 estable.                                                                        |
| 4    | Migrar o congelar los días antiguos y retirar la compatibilidad.                                                                                                            | Decisión del responsable.                                                              |

Reglas de toda fase:

- Durante la transición se leen ambos formatos. Nunca se borra un dato para "migrarlo".
- Las pruebas usan datos sintéticos. No se leen datos clínicos de producción para diseñar.
- La autoridad del servidor, las reglas y el contrato de verdad no se relajan para ganar velocidad.
- Antes de mover datos clínicos existentes debe haber un respaldo verificable.

## Medición (fase 0)

`daily_record_size_observed` (categoría `daily_record`) sale del listener del día cuando llega una
versión confirmada por el servidor. Cada equipo informa la 1.ª, 10.ª, 50.ª y 200.ª versión de cada
día. Por eso cada día genera como máximo cuatro eventos por equipo. El evento solo lleva tamaños
y conteos:

- `sizeBytes`: el día completo en bytes JSON UTF-8, una aproximación del tamaño en Firestore;
- `derivedBytes`: los datos derivados por cama, cunas incluidas, desglosados en `checkpointBytes`,
  `vitalsHistoryBytes` y `scoresBytes`;
- `movementDerivedBytes`: los mismos datos dentro de las fotos de altas, traslados y CMA;
- `syncHistoryBytes`: el registro `rayenSyncHistory`;
- `occupiedCount`: camas ocupadas;
- `count`: versiones distintas que el equipo recibió en esa sesión.

A partir de 700 KB el evento es `degraded`, para actuar antes del límite de 1 MiB. Los eventos se
ven en el registro de la función Netlify `operational-telemetry` y en Observabilidad del navegador.
`count × sizeBytes` aproxima lo que un día le cuesta en red a cada equipo.
