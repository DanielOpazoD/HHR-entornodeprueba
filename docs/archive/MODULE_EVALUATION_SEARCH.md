# Evaluación de Módulo: Sección de búsqueda

## Metadatos del módulo

- **Módulo:** Sección de búsqueda
- **Ruta(s) principal(es):**
  - [src/features/census/components/global-search](../src/features/census/components/global-search)
  - [src/services/repositories/PatientMasterRepository.ts](../src/services/repositories/PatientMasterRepository.ts)
  - [src/services/patient/patientHistoryService.ts](../src/services/patient/patientHistoryService.ts)
- **Fecha de evaluación:** 2026-04-16
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.7 / 7`
- **Resumen ejecutivo breve:** módulo fuerte, útil y ya bastante maduro. La búsqueda global resuelve bien el caso operativo importante de encontrar pacientes fuera del censo actual y navegar a sus episodios/documentos. Su punto más delicado era la divergencia entre Firestore y el historial operativo para episodios abiertos; esa frontera ya quedó saneada, documentada y bien testeada.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                                    |
| -------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.7 | Frente fuerte, clínicamente útil y ahora más estable en la reconciliación de episodios.                       |
| Estructura                       |  6.7 | Buena separación entre query, selección, agrupación y timeline.                                               |
| Organización                     |  6.7 | La carpeta del submódulo es clara y ahora tiene README propio.                                                |
| Buenas prácticas de codificación |  6.7 | Controllers puros, hooks con responsabilidad acotada y tests específicos.                                     |
| Coherencia funcional             |  6.8 | La UI ya alinea bien “Movimientos recientes” con “Episodios de hospitalización”.                              |
| Separación y límites             |  6.6 | Sigue siendo un submódulo repartido entre Firestore, historial y documentos, pero con límites más explícitos. |
| Estabilidad                      |  6.7 | Mejoró mucho al reconciliar episodios abiertos con el historial real.                                         |
| Escalabilidad                    |  6.5 | Puede crecer, aunque conviene no mezclar más lógica de reconciliación dentro del JSX.                         |
| Documentación                    |  6.6 | Ya tiene documentación útil y concreta del runtime.                                                           |
| Tests                            |  6.8 | Muy buena señal focalizada para grouping, contratos y timeline reconciliado.                                  |

---

## 3. Qué hace bien este módulo

- Busca pacientes de forma rápida sobre Firestore usando [usePatientSearchQuery.ts](../src/features/census/components/global-search/usePatientSearchQuery.ts).
- Carga historial operativo real y documentos por episodio desde [usePatientSelection.ts](../src/features/census/components/global-search/usePatientSelection.ts).
- Agrupa episodios y ahora también los reconcilia con el historial real en [episodeGroupingController.ts](../src/features/census/components/global-search/episodeGroupingController.ts).
- Tiene una UI bastante clara para:
  - resultados
  - detalle demográfico
  - movimientos recientes
  - episodios de hospitalización
  - navegación al censo y documentos clínicos

---

## 4. Hallazgos principales

- La búsqueda **sí** parte desde Firestore para resultados base, pero el detalle operativo del paciente depende también del historial construido desde daily records.
- Esa doble fuente de datos era el riesgo más importante del módulo, porque podía dejar:
  - movimientos recientes correctos
  - episodio todavía marcado como `Hospitalizado`
- Esa divergencia ya quedó corregida con reconciliación explícita antes de renderizar el timeline.
- El submódulo no necesita rescate estructural; lo que necesitaba era claridad sobre su frontera de datos.

---

## 5. Riesgos actuales

### Riesgo técnico

- Volver a mezclar en el render reglas de reconciliación de episodio que ya tienen hogar claro.
- Introducir otra fuente de verdad para episodios sin pasar por el controller de grouping/timeline.

### Riesgo operativo / clínico

- Mostrar estado de hospitalización incorrecto si reaparece una divergencia entre `patientMaster` y el historial operativo.
- Navegar a una fecha de censo incorrecta si se altera la regla de cierre del episodio sin tests.

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                                                 | Rol                       | Riesgo / observación                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| [src/features/census/components/global-search/usePatientSearchQuery.ts](../src/features/census/components/global-search/usePatientSearchQuery.ts)                       | query runtime             | Decide el acceso a Firestore y el debounce del resultado base.               |
| [src/features/census/components/global-search/usePatientSelection.ts](../src/features/census/components/global-search/usePatientSelection.ts)                           | selección e historial     | Es la bisagra entre paciente base, historial real y documentos del episodio. |
| [src/features/census/components/global-search/episodeGroupingController.ts](../src/features/census/components/global-search/episodeGroupingController.ts)               | grouping y reconciliación | Fuente crítica de verdad para agrupar y cerrar episodios.                    |
| [src/features/census/components/global-search/PatientEpisodeTimeline.tsx](../src/features/census/components/global-search/PatientEpisodeTimeline.tsx)                   | shell visual              | Ya más limpio, pero sigue siendo el orquestador visual principal.            |
| [src/features/census/components/global-search/patientEpisodeTimelineController.ts](../src/features/census/components/global-search/patientEpisodeTimelineController.ts) | timeline state            | Punto nuevo y valioso para mantener la reconciliación fuera del JSX.         |
| [src/services/repositories/PatientMasterRepository.ts](../src/services/repositories/PatientMasterRepository.ts)                                                         | búsqueda Firestore        | Importante porque define de dónde salen los resultados base de paciente.     |

---

## 7. Guardrails y checks relevantes

- `npm run typecheck`
- `npm run check:quality`
- suite focalizada del módulo

Resultado actual:

- **Typecheck:** OK
- **Quality:** OK
- **Tests focalizados:** `3/3` archivos verdes, `32/32` tests OK
- **Otros checks:** `check:quality` incluye `hhr/public-import-boundaries`, `census-runtime-boundary` y `docs-drift` verdes

---

## 8. Deuda técnica priorizada

### P1

- Mantener una sola política de reconciliación de episodios.
- Evitar que otra vista vuelva a recomponer el estado “abierto/cerrado” por fuera de `episodeGroupingController.ts`.

### P2

- Si el submódulo crece, sacar una policy pequeña del modal principal de búsqueda para navegación/teclado.

### P3

- Si aparece más complejidad documental, separar mejor la carga de documentos por episodio del resto de la selección.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Objetivo:** corregir el estado clínico visible del episodio.
- **Cambio ejecutado:** reconciliar episodios abiertos de Firestore con el historial real antes de renderizar el timeline.
- **Archivos tocados:**
  - [src/features/census/components/global-search/episodeGroupingController.ts](../src/features/census/components/global-search/episodeGroupingController.ts)
  - [src/features/census/components/global-search/PatientEpisodeTimeline.tsx](../src/features/census/components/global-search/PatientEpisodeTimeline.tsx)
- **Criterio de cierre:** logrado; el caso de egreso ya no queda como `Hospitalizado`.

### Bloque 2

- **Objetivo:** blindar los casos borde reales.
- **Cambio ejecutado:** agregar cobertura para egreso, traslado, fallecimiento y episodio abierto real.
- **Archivos tocados:**
  - [src/tests/features/census/global-search/groupEpisodesAsBlocks.test.ts](../src/tests/features/census/global-search/groupEpisodesAsBlocks.test.ts)
  - [src/tests/features/census/global-search/patientEpisodeTimelineController.test.ts](../src/tests/features/census/global-search/patientEpisodeTimelineController.test.ts)
- **Criterio de cierre:** logrado; el runtime crítico del submódulo quedó bien protegido.

### Bloque 3

- **Objetivo:** documentar la dualidad Firestore + historial operativo.
- **Cambio ejecutado:** agregar README del submódulo y controller de timeline para dejar la responsabilidad explícita.
- **Archivos tocados:**
  - [src/features/census/components/global-search/README.md](../src/features/census/components/global-search/README.md)
  - [src/features/census/components/global-search/patientEpisodeTimelineController.ts](../src/features/census/components/global-search/patientEpisodeTimelineController.ts)
- **Criterio de cierre:** logrado; el módulo ya no depende solo de conocimiento implícito.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** mantención prudente

Justificación:

- El módulo ya quedó en una buena zona.
- No necesita una ronda grande de refactor.
- Lo más valioso ya se hizo: corregir la divergencia clínica visible, endurecer tests y dejar clara la estrategia de datos.

---

## 11. Estado deseado después de la ronda

- Episodios y movimientos recientes alineados.
- Reconciliación de datos con un único hogar claro.
- Búsqueda global estable, comprensible y bien defendida con tests.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** no como prioridad
- **Siguiente módulo sugerido después de este:** Auditoría
- **Notas adicionales:** el módulo usa a propósito dos fuentes de datos distintas; eso no es un error, pero sí una frontera sensible que ya quedó mejor explicitada.
