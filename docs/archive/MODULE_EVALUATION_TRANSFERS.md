# Evaluación de Módulo: Gestión de Traslados

## Metadatos del módulo

- **Módulo:** Gestión de traslados
- **Ruta(s) principal(es):**
  - [src/features/transfers](../src/features/transfers)
  - [src/services/transfers](../src/services/transfers)
  - [src/hooks/useTransferManagement.ts](../src/hooks/useTransferManagement.ts)
  - [src/hooks/useTransferViewStates.ts](../src/hooks/useTransferViewStates.ts)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.8 / 7`
- **Resumen ejecutivo breve:** módulo fuerte, bien documentado y con una base de pruebas especialmente buena. El flujo principal está bastante domesticado: gestión de estados, tablas, notas inline y paquete documental ya no se sienten improvisados. Tras cerrar el primer bloque sobre `useTransferViewStates.ts` y el segundo sobre `TransferManagementView.tsx`, el runtime documental quedó más lineal y la vista principal más declarativa. Lo que le impide subir más no es deuda roja, sino el peso combinado de algunos services documentales grandes y la densidad residual del controller principal.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                                 |
| -------------------------------- | ---: | ---------------------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.8 | Módulo serio, con buena gobernanza y bastante estable.                                                     |
| Estructura                       |  6.7 | Muy buena separación entre `feature`, `services`, hooks runtime y controllers de vista.                    |
| Organización                     |  6.7 | El feature está bien organizado y tiene README útil; el frente documental suma complejidad, pero ordenada. |
| Buenas prácticas de codificación |  6.8 | Se nota disciplina en builders, controllers y fachada pública.                                             |
| Coherencia funcional             |  6.7 | El ciclo de vida del traslado y la separación activos/finalizados están bien asentados.                    |
| Separación y límites             |  6.7 | `public.ts`, boundary checks y controllers del feature están bastante bien cuidados.                       |
| Estabilidad                      |  6.7 | La batería focalizada está completamente verde y cubre bien runtime, mutaciones, queries y docs.           |
| Escalabilidad                    |  6.4 | Puede crecer, pero conviene vigilar la mezcla entre gestión operativa y generación documental.             |
| Documentación                    |  6.8 | Mejor que el promedio: README, reglas del módulo y referencias de guardrails claras.                       |
| Tests                            |  6.8 | Cobertura muy sólida y variada, incluyendo documento paquete, tablas, modales y services.                  |

---

## 3. Qué hace bien este módulo

- Tiene una guía del módulo especialmente clara:
  - [src/features/transfers/README.md](../src/features/transfers/README.md)
- La superficie pública está explicitada y es corta:
  - [src/features/transfers/public.ts](../src/features/transfers/public.ts)
- El feature ya empuja bastante lógica de pantalla a controllers dedicados:
  - [transferManagementViewController.ts](../src/features/transfers/components/controllers/transferManagementViewController.ts)
  - [transferTableController.ts](../src/features/transfers/components/controllers/transferTableController.ts)
  - [transferFormController.ts](../src/features/transfers/components/controllers/transferFormController.ts)
  - [transferNotesController.ts](../src/features/transfers/components/controllers/transferNotesController.ts)
- La persistencia está razonablemente bien separada por responsabilidades:
  - [transferService.ts](../src/services/transfers/transferService.ts)
  - [transferQueriesService.ts](../src/services/transfers/transferQueriesService.ts)
  - [transferMutationsService.ts](../src/services/transfers/transferMutationsService.ts)
- El frente documental ya tiene seams útiles y cobertura propia.

---

## 4. Hallazgos principales

- Es uno de los módulos mejor documentados del sistema.
- La vista principal de gestión está más domesticada que antes gracias a varios builders de bindings y modelos por sección.
- La principal complejidad residual está en dos fronteras:
  - runtime UX de modales + paquete documental
  - services grandes de mutación/generación documental
- El Bloque 1 ya mejoró una parte sensible del runtime de paquetes: `useTransferViewStates.ts` dejó de duplicar la decisión de abrir cuestionario/paquete y la aplicación del resultado de generación documental.
- El Bloque 2 sacó otra porción de shell logic de `TransferManagementView.tsx`, empujando copy y estados de carga/toggle a `transferManagementViewController.ts`.
- No se ve deuda roja inmediata; se ve más bien una necesidad de seguir bajando costo cognitivo en los hotspots más pesados.

---

## 5. Riesgos actuales

### Riesgo técnico

- Volver a mezclar lógica operativa y documental dentro de la misma vista o hook grande.
- Reabsorber en `TransferManagementView.tsx` o `useTransferViewStates.ts` decisiones que hoy ya están mejor encapsuladas.

### Riesgo operativo / clínico

- Regresiones en:
  - cambio de estado del traslado
  - separación entre activos/finalizados
  - notas inline
  - paquete documental y cache de documentos
  - sincronización realtime de solicitudes activas vs historial

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                                                   | Rol                                  | Riesgo / observación                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [src/services/transfers/transferMutationsService.ts](../src/services/transfers/transferMutationsService.ts)                                                               | Mutaciones del ciclo de vida         | `339` líneas; fuerte pero ya grande, muy sensible por impacto operativo.                                |
| [src/features/transfers/components/controllers/transferManagementViewController.ts](../src/features/transfers/components/controllers/transferManagementViewController.ts) | Read models/bindings de la vista     | `322` líneas; valioso y ya más responsable del shell, pero claramente central.                          |
| [src/features/transfers/components/TransferManagementView.tsx](../src/features/transfers/components/TransferManagementView.tsx)                                           | Vista principal del módulo           | `317` líneas; mejor declarativa tras el Bloque 2, aunque sigue siendo la pieza más visible del feature. |
| [src/services/transfers/templateGeneratorService.ts](../src/services/transfers/templateGeneratorService.ts)                                                               | Generación DOCX/XLSX por plantilla   | `321` líneas; hotspot documental claro.                                                                 |
| [src/services/transfers/documentFallbacks.ts](../src/services/transfers/documentFallbacks.ts)                                                                             | Fallbacks documentales               | `320` líneas; sensible por degradación y mantenimiento.                                                 |
| [src/hooks/useTransferViewStates.ts](../src/hooks/useTransferViewStates.ts)                                                                                               | Runtime UX de modales y paquete docs | `255` líneas; ya más lineal tras el Bloque 1, pero sigue siendo un hook central.                        |

---

## 7. Guardrails y checks relevantes

- `npx vitest run src/tests/features/transfers src/tests/services/transfers/transferService.mutations.test.ts src/tests/services/transfers/transferService.queries.test.ts src/tests/services/transfers/documentGeneratorService.test.ts src/tests/services/transfers/templateGenerator.test.ts src/tests/services/transfers/documentFallbacks.test.ts src/tests/hooks/useTransferManagement.test.ts src/tests/hooks/useTransferViewStates.modal-state.test.ts src/tests/hooks/useTransferViewStates.document-package.test.ts src/tests/hooks/useTransferModalForm.test.ts src/tests/hooks/usePatientTransfers.test.ts`
- `npm run check:transfers-feature-boundary`
- `npm run check:quality`
- `npm run typecheck`

Resultado actual de esta evaluación:

- **Suite focalizada de transfers:** `18/18` archivos verdes, `94/94` tests OK
- **Transfers feature boundary:** verde
- **Bloque 1 runtime documental:** `17/17` tests OK entre controller + hook, `npm run typecheck` verde
- **Bloque 2 shell de la vista:** `9/9` tests OK entre controller + `TransferManagementView`, `npm run check:transfers-feature-boundary` y `npm run typecheck` verdes

La evaluación partió sin cambios de código, pero luego quedó reforzada con el primer bloque de mejoras del runtime documental, manteniendo verde la señal específica del módulo.

---

## 8. Deuda técnica priorizada

### P1

- Seguir reduciendo coordinación incidental en:
  - `transferManagementViewController.ts`
  - y en los services documentales grandes (`templateGeneratorService.ts`, `documentFallbacks.ts`)

### P2

- Bajar algo de densidad en:
  - `transferMutationsService.ts`
  - `templateGeneratorService.ts`
  - `documentFallbacks.ts`

### P3

- Mantener la disciplina de controllers/bindings de vista para que no vuelva a crecer JSX inline en tablas y modales.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Objetivo:** bajar algo de coordinación del runtime de modales/documentos.
- **Estado:** completado
- **Cambio realizado:** `useTransferViewStates.ts` ahora usa `resolveTransferDocumentWorkflowPlan(...)` y `resolveTransferDocumentPackageApplyPlan(...)` desde `transferViewStatesController.ts`, evitando duplicación entre abrir cuestionario/ver paquete y aplicar resultados de generación.
- **Archivos tocados:**
  - [src/hooks/useTransferViewStates.ts](../src/hooks/useTransferViewStates.ts)
  - [src/hooks/controllers/transferViewStatesController.ts](../src/hooks/controllers/transferViewStatesController.ts)
- **Tests / checks ejecutados:**
  - `src/tests/hooks/controllers/transferViewStatesController.test.ts`
  - `src/tests/hooks/useTransferViewStates.modal-state.test.ts`
  - `src/tests/hooks/useTransferViewStates.document-package.test.ts`
- **Criterio de cierre:** cumplido; menos handlers/estado incidental manual en el hook de runtime.

### Bloque 2

- **Objetivo:** seguir domesticando la vista principal de gestión sin tocar UX.
- **Estado:** completado
- **Cambio realizado:** `TransferManagementView.tsx` ahora consume modelos explícitos para encabezado, sección activa cargando y sección de finalizados (`title`, `description`, `toggleIcon`, mensajes de carga), empujando copy y estados de shell a `transferManagementViewController.ts`.
- **Archivos tocados:**
  - [src/features/transfers/components/TransferManagementView.tsx](../src/features/transfers/components/TransferManagementView.tsx)
  - [src/features/transfers/components/controllers/transferManagementViewController.ts](../src/features/transfers/components/controllers/transferManagementViewController.ts)
- **Tests / checks ejecutados:**
  - `src/tests/features/transfers/TransferManagementView.grouping.test.tsx`
  - `src/tests/features/transfers/TransferManagementView.notes-inline.test.tsx`
  - `src/tests/features/transfers/transferManagementViewController.test.ts`
- **Criterio de cierre:** cumplido; más lectura declarativa de la vista y menos composición inline.

### Bloque 3

- **Objetivo:** consolidar el frente documental.
- **Cambio esperado:** extraer una política pura o una convergencia local de errores/fallbacks en services documentales.
- **Archivos probables:**
  - [src/services/transfers/documentGeneratorService.ts](../src/services/transfers/documentGeneratorService.ts)
  - [src/services/transfers/templateGeneratorService.ts](../src/services/transfers/templateGeneratorService.ts)
  - [src/services/transfers/documentFallbacks.ts](../src/services/transfers/documentFallbacks.ts)
- **Tests / checks requeridos:**
  - `src/tests/services/transfers/documentGeneratorService.test.ts`
  - `src/tests/services/transfers/templateGenerator.test.ts`
  - `src/tests/services/transfers/documentFallbacks.test.ts`
- **Criterio de cierre:** menos branching incidental dentro de services grandes, sin tocar semántica del flujo documental.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** saneamiento focalizado

Justificación:

- El módulo ya está fuerte.
- Tiene muy buena señal de tests y boundary.
- No necesita re-arquitectura; sí conviene seguir quitando densidad local en runtime y documentación/persistencia del flujo.

---

## 11. Estado deseado después de la ronda

- Runtime de traslados más lineal y con menos handlers manuales.
- Vista principal todavía más declarativa.
- Frontera documental más fácil de cambiar sin tocar varios services a la vez.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** sí
- **Siguiente módulo sugerido después de este:** CUDYR
- **Notas adicionales:** traslados ya está en una zona muy seria. La mejora aquí es de consolidación y reducción de costo cognitivo, no de rescate.
