# Evaluación de Módulo: Solicitud de Exámenes de Laboratorio

## Metadatos del módulo

- **Módulo:** Solicitud de exámenes de laboratorio
- **Ruta(s) principal(es):**
  - [src/hooks/useExamRequest.ts](../src/hooks/useExamRequest.ts)
  - [src/features/census/components/exam-request/ExamRequestModal.tsx](../src/features/census/components/exam-request/ExamRequestModal.tsx)
  - [src/features/census/components/exam-request/examRequestPrintStyles.ts](../src/features/census/components/exam-request/examRequestPrintStyles.ts)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.7 / 7`
- **Resumen ejecutivo breve:** módulo sólido, funcional y ahora bastante más domesticado. La UX sigue guiada por el formulario físico oficial, pero ya no depende tanto de wiring manual en el hook ni de branching grande en el modal. Su límite actual ya no es desorden básico, sino que todavía conserva un shell modal relativamente grande y un flujo de impresión sensible por naturaleza.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                    |
| -------------------------------- | ---: | --------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.7 | Módulo estable, útil y ahora mejor convergido entre estado, shell e impresión.                |
| Estructura                       |  6.6 | Sigue siendo simple, pero ya tiene controllers chicos donde antes había wiring manual.        |
| Organización                     |  6.7 | Más fácil de leer: hook, modal shell e impresión ya no viven mezclados en un solo lugar.      |
| Buenas prácticas de codificación |  6.7 | Mejoró el modelado intermedio y se redujo la manipulación DOM ad-hoc dentro del hook.         |
| Coherencia funcional             |  6.7 | El formulario sigue replicando bien el documento físico y mantiene fidelidad con el uso real. |
| Separación y límites             |  6.6 | El módulo ya tiene mejor separación entre estado, view-model y flujo de impresión.            |
| Estabilidad                      |  6.7 | La señal focalizada está verde y el print flow quedó más encapsulado.                         |
| Escalabilidad                    |  6.5 | Puede crecer con menos riesgo, aunque no conviene volver a cargar demasiado el modal.         |
| Documentación                    |  6.5 | La guía sigue ayudando; ahora además la arquitectura del módulo es más legible.               |
| Tests                            |  6.7 | La cobertura del flujo visible y de los controllers subió de forma concreta y útil.           |

---

## 3. Qué hace bien este módulo

- Tiene una guía de intención bastante clara:
  - [docs/LABORATORY_FORM_GUIDE.md](../docs/LABORATORY_FORM_GUIDE.md)
- Replica de forma consistente el formulario físico institucional.
- El estado básico del formulario está desacoplado en:
  - [useExamRequest.ts](../src/hooks/useExamRequest.ts)
- La integración con censo y acciones rápidas ya está bastante natural desde el resto del sistema.

---

## 4. Hallazgos principales

- Es un módulo más chico y directo que otros del sistema.
- La mayor parte del peso sigue estando en:
  - [ExamRequestModal.tsx](../src/features/census/components/exam-request/ExamRequestModal.tsx)
- Pero ya quedó mejor repartido entre:
  - [useExamRequest.ts](../src/hooks/useExamRequest.ts)
  - [examRequestController.ts](../src/features/census/components/exam-request/examRequestController.ts)
  - [examRequestPrintController.ts](../src/features/census/components/exam-request/examRequestPrintController.ts)
  - [examRequestModalController.ts](../src/features/census/components/exam-request/examRequestModalController.ts)
- La lógica de impresión sigue siendo sensible por definición, pero ya no vive mezclada con el resto del hook.
- No se ve deuda roja; el módulo quedó bastante bien consolidado para su tamaño.

---

## 5. Riesgos actuales

### Riesgo técnico

- Seguir agregando categorías, reglas o variantes directamente dentro de `ExamRequestModal.tsx`.
- Volver a cargar demasiada variabilidad nueva dentro de `ExamRequestModal.tsx` en vez de seguir usando seams pequeños.

### Riesgo operativo / clínico

- Regresiones en:
  - selección de exámenes
  - reseteo al abrir/cerrar
  - impresión limpia del formulario
  - fidelidad con el documento físico esperado

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                               | Rol                            | Riesgo / observación                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| [src/features/census/components/exam-request/ExamRequestModal.tsx](../src/features/census/components/exam-request/ExamRequestModal.tsx)                                           | Modal principal del formulario | `254` líneas; ya más declarativo, aunque sigue siendo el shell grande del módulo.    |
| [src/hooks/useExamRequest.ts](../src/hooks/useExamRequest.ts)                                                                         | Estado del formulario          | `77` líneas; más lineal y sin mezclar ya el flujo de impresión.                      |
| [src/features/census/components/exam-request/examRequestModalController.ts](../src/features/census/components/exam-request/examRequestModalController.ts) | View-model del modal           | `107` líneas; seam útil que ahora concentra shell y agrupación del formulario.       |
| [src/features/census/components/exam-request/examRequestPrintController.ts](../src/features/census/components/exam-request/examRequestPrintController.ts)                         | Runtime de impresión           | `68` líneas; encapsula el snapshot/apply/restore del print flow.                     |
| [src/features/census/components/exam-request/examRequestPrintStyles.ts](../src/features/census/components/exam-request/examRequestPrintStyles.ts)                                 | Contrato visual de impresión   | `100` líneas; sigue siendo sensible por paridad con el formulario real y el impreso. |

---

## 7. Guardrails y checks relevantes

- `npx vitest run src/tests/hooks/useExamRequest.test.ts src/tests/hooks/controllers/examRequestController.test.ts src/tests/components/ExamRequestModal.integration.test.tsx src/tests/components/examRequestModalController.test.ts src/tests/components/examRequestPrintController.test.ts`
- `npm run check:quality`
- `npm run typecheck`

Resultado actual de esta evaluación:

- **Suite focalizada de solicitud de laboratorio:** `5/5` archivos verdes, `17/17` tests OK
- No hay hoy un boundary check dedicado del módulo.

No se hicieron cambios de código en esta evaluación.

---

## 8. Deuda técnica priorizada

### P1

- Vigilar que nuevas variantes del formulario sigan entrando por los controllers ya abiertos y no vuelvan a crecer inline en el modal.

### P2

- Si el flujo de impresión cambia, mantener la encapsulación actual y evitar volver a meter timers/DOM directo dentro del hook.

### P3

- Reforzar solo si aparece un caso real nuevo de impresión o de categorías dinámicas.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Estado:** completado
- **Resultado:** `useExamRequest.ts` delega reset/toggle/count a `examRequestController.ts`.

### Bloque 2

- **Estado:** completado
- **Resultado:** `ExamRequestModal.tsx` consume un shell/layout model desde `examRequestModalController.ts`.

### Bloque 3

- **Estado:** completado
- **Resultado:** el print flow quedó encapsulado en `examRequestPrintController.ts`.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** mantenimiento controlado

Justificación:

- El módulo funciona bien.
- Ya recibió los cortes de mayor retorno.
- Seguir mucho más ahora probablemente sería sobreingeniería salvo que aparezca una necesidad funcional nueva.

---

## 11. Estado deseado después de la ronda

- Hook del formulario lineal.
- Modal más declarativo.
- Impresión encapsulada y testeada.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** no de forma inmediata; solo si aparece una necesidad funcional nueva
- **Siguiente módulo sugerido después de este:** Solicitud de imágenes
- **Notas adicionales:** el módulo ya quedó en una zona bastante buena para su tamaño; conviene seguir el orden del inventario antes de volver aquí.
