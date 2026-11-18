# Evaluación de Módulo: Censo Diario

## Metadatos del módulo

- **Módulo:** Censo diario
- **Ruta(s) principal(es):**
  - [src/features/census](../src/features/census)
  - [src/application/census](../src/application/census)
  - [src/application/daily-record](../src/application/daily-record)
  - [src/application/patient-flow](../src/application/patient-flow)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.8 / 7`
- **Resumen ejecutivo breve:** módulo muy potente, muy cubierto y con arquitectura bastante seria. Sigue siendo el frente con más churn, más volumen y más sensibilidad operativa del sistema, pero el baseline de tests está verde y `PatientRow` viene perdiendo wiring incidental de forma sostenida, lo que mejora de forma tangible la foto de estabilidad y evolución.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                               |
| -------------------------------- | ---: | -------------------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.7 | Muy buen nivel para un módulo tan grande, con menos fricción incidental que al inicio de la ronda.       |
| Estructura                       |  6.6 | La separación `components / hooks / controllers / domain / context / validation` está bien pensada.      |
| Organización                     |  6.5 | Hay mucha organización y ownership explícito; sigue pesado, pero más ordenado en el frente `PatientRow`. |
| Buenas prácticas de codificación |  6.7 | Hay bastante controller puro, command/runtime y boundaries bien marcados.                                |
| Coherencia funcional             |  6.4 | La coherencia clínica es buena y el wiring principal viene convergiendo mejor.                           |
| Separación y límites             |  6.6 | Muy buena gobernanza de feature boundaries y ownership de controllers.                                   |
| Estabilidad                      |  6.6 | La suite focalizada volvió a verde completo y el baseline de `PatientRow` hoy se ve bastante más firme.  |
| Escalabilidad                    |  6.4 | Puede crecer, pero conviene por bloques; el costo cognitivo y de churn sigue siendo alto.                |
| Documentación                    |  6.6 | El README del feature y los invariantes están bien explicitados.                                         |
| Tests                            |  6.5 | Cobertura enorme y muy útil, con baseline focalizado actualmente verde en `PatientRow`.                  |

---

## 3. Qué hace bien este módulo

- Tiene una arquitectura interna muy trabajada y explícita, especialmente para un módulo tan grande y central.
- La documentación del feature es fuerte:
  - [src/features/census/README.md](../src/features/census/README.md)
  - [src/application/patient-flow/README.md](../src/application/patient-flow/README.md)
- Hay muchos invariantes clínico-operativos bien formulados:
  - fecha / turno
  - nuevo ingreso
  - modales según capabilities
  - señales obstétricas
  - bootstrap del día
- La cobertura de tests es enorme:
  - `239` archivos de test entre `features/views census`
  - `1139` definiciones `describe/it`
- Los boundaries y guardrails del módulo están muy bien protegidos por `check:quality`.

---

## 4. Hallazgos principales

- Es uno de los módulos más grandes y complejos del sistema, y eso se nota en navegación, churn y sensibilidad de cambios.
- La estructura está bien, pero el costo cognitivo sigue siendo alto, especialmente en `PatientRow`, movimientos, acciones de tabla y wiring del runtime.
- Aunque el scorecard hoy no lo marca como hotspot rojo, el módulo sigue siendo el frente con más churn reciente del repo.
- La suite focalizada es enorme y cubre bastante bien el frente `PatientRow`; el baseline volvió a verde completo y ya hubo varias pasadas para converger wiring duplicado de modales, secciones, launcher orbital, menú de acciones, inputs clínicos, hooks operativos asociados y estados UI pequeños del árbol de fila.

---

## 5. Riesgos actuales

### Riesgo técnico

- Reintroducir lógica de negocio en `PatientRow` o en handlers UI si no se mantiene el patrón actual de controllers.
- Seguir agregando flujos al censo sin converger más los wiring paths de tabla, modales y acciones.

### Riesgo operativo / clínico

- Regresiones en:
  - movimientos
  - ingresos / egresos
  - indicadores de fila
  - edición demográfica
  - acciones clínicas rápidas
- Como el censo es núcleo del sistema, pequeñas desviaciones impactan mucho la experiencia diaria.

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                             | Rol                            | Riesgo / observación                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| [src/features/census/email/hooks/useCensusEmailRecipientLists.ts](../src/features/census/email/hooks/useCensusEmailRecipientLists.ts)                                                           | Flujo sensible ligado al censo | `390` líneas; no es la tabla en sí, pero sí un frente operativo asociado importante. |
| [src/hooks/useBedManagementReducer.ts](../src/hooks/useBedManagementReducer.ts)                                                                     | Estado/patches de camas        | `156` líneas; ya mucho mejor, pero sensible.                                         |
| [src/features/census/controllers/patientRowBindingsController.ts](../src/features/census/controllers/patientRowBindingsController.ts)               | Wiring de fila                 | `282` líneas; punto central del costo cognitivo de `PatientRow`.                     |
| [src/features/census/controllers/patientRowBindingSectionsController.ts](../src/features/census/controllers/patientRowBindingSectionsController.ts) | Secciones de binding por fila  | `156` líneas; importante para mantener separación.                                   |
| [src/hooks/useCensusLogic.ts](../src/hooks/useCensusLogic.ts)                                                                                       | Orquestación general del censo | Relativamente chico (`64` líneas), pero representa el punto de entrada del módulo.   |

Además, el scorecard marca:

- **Recent Churn (30 días):** `src/features/census/: 728 archivos tocados`

Eso lo convierte en uno de los frentes más delicados del repo aunque ya no figure como hotspot “rojo”.

---

## 7. Guardrails y checks relevantes

- `npm run typecheck`
- `npm run check:quality`
- `npx vitest run src/tests/views/census src/tests/features/census src/tests/components/PatientRow*.test.tsx`

Resultado actual:

- **Typecheck global:** verde
- **Quality global:** verde
- **Suite focalizada de censo:** `240/240` archivos verdes, `865/865` tests OK

---

## 8. Deuda técnica priorizada

### P1

- Mantener baseline completamente verde del frente `PatientRow`.
- Seguir convergiendo el wiring de fila para que actions/modals/demographics no dependan de acoplamientos UI frágiles.
- Mantener el frente `PatientRow` en cortes chicos y verificables, evitando que el churn reciente vuelva a densificar componentes centrales.

### P2

- Seguir desacoplando `PatientRow` en secciones/view-models más explícitos.
- Mantener más aisladas las reglas clínicas/temporales del render de tabla.

### P3

- Afinar el costo cognitivo de algunos controladores grandes del frente `census`.
- Reforzar documentación operativa de invariantes de movimientos y edición de fila.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Objetivo:** mantener el baseline de `PatientRow` totalmente verde.
- **Cambio esperado:** seguir evitando fragilidad por imports lazy, modales y menús de acciones.
  - **Archivos probables:**
  - [src/tests/components/PatientRow.crib-and-demographics.test.tsx](../src/tests/components/PatientRow.crib-and-demographics.test.tsx)
  - [src/tests/components/PatientRow.layout-and-actions.test.tsx](../src/tests/components/PatientRow.layout-and-actions.test.tsx)
  - runtime/bindings asociados
- **Tests / checks requeridos:** suite focalizada de censo
- **Criterio de cierre:** conservar `240/240` archivos verdes en la batería focalizada.

### Bloque 2

- **Objetivo:** seguir domesticando el frente `PatientRow`.
- **Cambio esperado:** mover más wiring de fila a controllers/view-models puros y reducir acoplamiento entre UI y acciones.
  - **Archivos probables:**
  - [patientRowBindingsController.ts](../src/features/census/controllers/patientRowBindingsController.ts)
  - [patientRowBindingSectionsController.ts](../src/features/census/controllers/patientRowBindingSectionsController.ts)
  - [patientRowMainViewController.ts](../src/features/census/controllers/patientRowMainViewController.ts)
- **Tests / checks requeridos:** tests de `PatientRow` + tabla
- **Criterio de cierre:** menos branching visible y menos fragilidad de acciones/modales. Convergencias ya aplicadas: `buildPatientRowModalsBindings(...)` reutiliza el mismo builder de secciones que usa el resto del wiring, el diálogo de indicaciones médicas salió del componente del menú y el estado de modales de fila ahora comparte helpers puros de visibilidad/cierre.

### Bloque 3

- **Objetivo:** seguir separando lógica operativa de render.
- **Cambio esperado:** que reglas de movimientos, turno/fecha y capabilities sigan sin reaparecer en componentes.
- **Archivos probables:**
  - command/runtime controllers
  - `clinicalShiftCalendarController`
  - `patientMovement*`
- **Tests / checks requeridos:** tests de movimientos e invariantes temporales
- **Criterio de cierre:** mismas reglas, menos complejidad incidental.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** saneamiento focalizado con prioridad alta

Justificación:

- Es el corazón operativo del programa.
- Ya tiene arquitectura seria.
- El retorno más alto no está en re-arquitectura grande, sino en:
  - baseline verde completo
  - bajar fragilidad de `PatientRow`
  - seguir domesticando costo cognitivo

---

## 11. Estado deseado después de la ronda

- Baseline de censo completamente verde.
- `PatientRow` más estable y menos acoplado.
- Menor riesgo de regresiones en modales, acciones y movimientos.
- El módulo sigue fuerte, pero además más predecible para evolucionar.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** sí
- **Siguiente módulo sugerido después de este:** Entrega de turno médico
- **Notas adicionales:** Censo diario es probablemente el módulo más sensible del sistema. Su calidad base es alta, pero hoy la prioridad correcta es consolidación y estabilidad, no más complejidad nueva.
