# Búsqueda global de pacientes

Este submódulo usa dos fuentes de datos a propósito:

- **Firestore `patientMaster`** para resultados rápidos de búsqueda
- **historial operativo** desde daily records para movimientos reales

## Cómo se reparte la responsabilidad

- [usePatientSearchQuery.ts](./usePatientSearchQuery.ts)
  ejecuta la búsqueda base en Firestore.
- [usePatientSelection.ts](./usePatientSelection.ts)
  carga historial clínico real y documentos del episodio.
- [episodeGroupingController.ts](./episodeGroupingController.ts)
  agrupa hospitalizaciones y reconcilia episodios abiertos con el historial.
- [patientEpisodeTimelineController.ts](./patientEpisodeTimelineController.ts)
  arma el estado final que renderiza el timeline.

## Regla importante

El timeline no debe asumir que `patientMaster.hospitalizations` esté siempre
perfectamente sincronizado. Si Firestore sigue mostrando un episodio abierto,
pero el historial real ya contiene:

- `discharge`
- `transfer`
- `Fallecimiento`

la UI debe cerrar ese episodio antes de renderizarlo.

## Contrato de búsqueda correcto

- `patientMaster` sirve para descubrir candidatos por nombre/RUT.
- Al seleccionar un paciente, `usePatientSelection` debe pedir hidratación remota
  completa del historial (`forceFullRemoteHydration`) para no depender de datos
  locales incompletos ni del índice maestro parcial.
- Si el mismo paciente se selecciona nuevamente mientras la hidratación está en
  curso, o mientras siga vigente la misma versión de `patientMaster.updatedAt`,
  `usePatientSelection` debe reutilizar la promesa/datos ya descargados en vez
  de disparar otra lectura remota completa.
- `patientHistoryService` debe reconstruir movimientos desde daily records y
  conservar todas las hospitalizaciones observadas. Una readmisión posterior a
  egreso/traslado es un nuevo `admission`, no un `internal_move` desde la cama
  previa.
- `patientEpisodeTimelineController` debe preferir la historia operativa real
  cuando está disponible; `patientMaster.hospitalizations` queda como fallback
  inicial/rápido.
- En UI, `internal_move` se presenta como movimiento dependiente con sangría,
  para distinguirlo de `Ingreso`, `Egreso` y `Traslado`.

## Guardrail de regresión

El flujo integrado queda cubierto por
`src/tests/features/census/global-search/patientSearchTimelineIntegration.test.tsx`.
Ese test debe seguir pasando cuando se modifique búsqueda, selección de paciente,
historia de movimientos o timeline. En particular bloquea estas regresiones:

- seleccionar un paciente sin `forceFullRemoteHydration`
- repetir la descarga remota completa para el mismo paciente ya seleccionado
- renderizar solo el último episodio cuando `patientMaster` viene incompleto
- convertir una readmisión posterior a egreso en falso `Cambio de cama`
- presentar `internal_move` como evento plano en vez de submovimiento con sangría

## Objetivo

- mantener búsqueda rápida
- mantener cronología correcta
- evitar divergencias entre “Movimientos recientes” y “Episodios de hospitalización”
