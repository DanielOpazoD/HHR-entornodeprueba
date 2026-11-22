# Evaluación de Módulo: Solicitud de Imágenes

## Metadatos del módulo

- **Módulo:** Solicitud de imágenes
- **Ruta(s) principal(es):**
  - [src/features/census/components/imaging-request/ImagingRequestDialog.tsx](../src/features/census/components/imaging-request/ImagingRequestDialog.tsx)
  - [src/features/census/components/imaging-request/useImagingLogic.ts](../src/features/census/components/imaging-request/useImagingLogic.ts)
  - [src/features/census/components/imaging-request/ImagingSidebar.tsx](../src/features/census/components/imaging-request/ImagingSidebar.tsx)
  - [src/features/census/components/imaging-request/ImagingViewer.tsx](../src/features/census/components/imaging-request/ImagingViewer.tsx)
  - [src/features/census/components/imaging-request/imagingRequestPdfService.ts](../src/features/census/components/imaging-request/imagingRequestPdfService.ts)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.7 / 7`
- **Resumen ejecutivo breve:** módulo útil, visualmente claro y ahora bastante más domesticado. La experiencia sigue apoyándose en formularios PDF oficiales, pero ya no depende tanto de branching artesanal entre modal, viewer y service PDF. Su límite actual ya no es falta de seams, sino la sensibilidad natural de un frente visual-interactivo acoplado a templates oficiales.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                    |
| -------------------------------- | ---: | --------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.7 | Frente funcional, estable y ahora mejor convergido entre modal, viewer y PDF runtime.         |
| Estructura                       |  6.7 | Tiene mejor estructura real gracias a controllers específicos de modal y viewer.              |
| Organización                     |  6.7 | La superficie principal quedó bastante más fácil de seguir.                                   |
| Buenas prácticas de codificación |  6.6 | Hay lazy loading útil, logging correcto y menos branching visual/manual inline.               |
| Coherencia funcional             |  6.8 | La UX sigue replicando bien el flujo real de solicitud, encuesta y consentimiento.            |
| Separación y límites             |  6.7 | `useImagingLogic`, `ImagingViewer` y `imagingRequestPdfService` ya quedaron mejor repartidos. |
| Estabilidad                      |  6.6 | La señal focalizada está verde y el runtime del modal quedó más predecible.                   |
| Escalabilidad                    |  6.5 | Puede crecer con menos riesgo, aunque no conviene volver a engordar el viewer principal.      |
| Documentación                    |  6.6 | La guía específica del módulo es clara y útil.                                                |
| Tests                            |  6.6 | La señal útil subió con cobertura directa de modal-controller y viewer-controller.            |

---

## 3. Qué hace bien este módulo

- Tiene una guía clara de intención y funcionamiento:
  - [docs/features/imaging-request-module.md](../docs/features/imaging-request-module.md)
- El flujo principal está bien resuelto para el usuario:
  - seleccionar documento
  - marcar cruces o texto
  - autocompletar datos del paciente
  - imprimir el PDF oficial
- Usa carga lazy del servicio pesado de PDF dentro de:
  - [useImagingLogic.ts](../src/features/census/components/imaging-request/useImagingLogic.ts)
- El servicio PDF está bien organizado alrededor de templates y coordenadas.

---

## 4. Hallazgos principales

- La experiencia general del módulo sigue siendo buena y coherente.
- El principal peso técnico sigue estando en:
  - [imagingRequestPdfService.ts](../src/features/census/components/imaging-request/imagingRequestPdfService.ts)
- Pero ya quedó mejor repartido entre:
  - [imagingRequestDialogController.ts](../src/features/census/components/imaging-request/imagingRequestDialogController.ts)
  - [imagingViewerController.ts](../src/features/census/components/imaging-request/imagingViewerController.ts)
  - [useImagingLogic.ts](../src/features/census/components/imaging-request/useImagingLogic.ts)
  - [ImagingViewer.tsx](../src/features/census/components/imaging-request/ImagingViewer.tsx)
- `ImagingViewer.tsx` ya no mantiene el branching grande por documento dentro del JSX.
- `imagingRequestPdfService.ts` sigue siendo el hotspot principal, aunque quedó algo más lineal en sus helpers internos.

---

## 5. Riesgos actuales

### Riesgo técnico

- Volver a meter demasiadas variantes documentales inline en `ImagingViewer.tsx` o `useImagingLogic.ts`.
- Mantener demasiadas coordenadas y overlays manuales repartidos entre frontend y servicio PDF.

### Riesgo operativo / clínico

- Regresiones en:
  - autocompletado de datos del paciente
  - precisión visual del marcado
  - consistencia entre preview y PDF impreso
  - manejo de texto libre en posiciones específicas

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                       | Rol                            | Riesgo / observación                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| [src/features/census/components/imaging-request/imagingRequestPdfService.ts](../src/features/census/components/imaging-request/imagingRequestPdfService.ts)                                               | Servicio PDF                   | `266` líneas; sigue siendo el hotspot más sensible por templates, coordenadas e impresión directa. |
| [src/features/census/components/imaging-request/ImagingViewer.tsx](../src/features/census/components/imaging-request/ImagingViewer.tsx)                                         | Visor interactivo principal    | `114` líneas; ya bastante más declarativo gracias al controller del viewer.                        |
| [src/features/census/components/imaging-request/imagingViewerController.ts](../src/features/census/components/imaging-request/imagingViewerController.ts)               | View-model del visor           | `120` líneas; seam útil que ahora concentra overlays y assets por documento.                       |
| [src/features/census/components/imaging-request/imagingRequestDialogController.ts](../src/features/census/components/imaging-request/imagingRequestDialogController.ts) | Shell/runtime policy del modal | `125` líneas; concentra catálogo, shell del paciente, canvas intent y print routing.               |
| [src/features/census/components/imaging-request/ImagingRequestDialog.tsx](../src/features/census/components/imaging-request/ImagingRequestDialog.tsx)                                           | Shell del modal                | `130` líneas; más limpio y con menos catálogo/configuración inline.                                |
| [src/features/census/components/imaging-request/ImagingSidebar.tsx](../src/features/census/components/imaging-request/ImagingSidebar.tsx)                                       | Sidebar de herramientas        | `151` líneas; clara, aunque más visual que modelada.                                               |
| [src/features/census/components/imaging-request/useImagingLogic.ts](../src/features/census/components/imaging-request/useImagingLogic.ts)                                       | Runtime del modal              | `114` líneas; más lineal, ya sin routing de impresión ni canvas intent inline.                     |

---

## 7. Guardrails y checks relevantes

- `npx vitest run src/tests/components/ImagingRequestDialog.test.tsx src/tests/components/imagingRequestDialogController.test.ts src/tests/components/imagingViewerController.test.ts src/tests/services/pdf/imagingRequestPdfService.test.ts`
- `npm run typecheck`
- `npm run check:quality`

Resultado actual de esta evaluación:

- **Suite focalizada de solicitud de imágenes:** `4/4` archivos verdes, `16/16` tests OK
- No aparece hoy un boundary check dedicado del módulo.

---

## 8. Deuda técnica priorizada

### P1

- Vigilar que nuevas variantes documentales entren por los controllers abiertos y no vuelvan a inflar el viewer.

### P2

- Si el frente PDF gana más variantes, seguir convergiendo helpers internos en `imagingRequestPdfService.ts`.

### P3

- Reforzar solo si aparece un caso real nuevo de marcado o de texto libre en posiciones especiales.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Estado:** completado
- **Resultado:** `useImagingLogic.ts` delega shell, cleanup, print routing y canvas intent a `imagingRequestDialogController.ts`.

### Bloque 2

- **Estado:** completado
- **Resultado:** `ImagingViewer.tsx` consume el model de overlays/assets desde `imagingViewerController.ts`.

### Bloque 3

- **Estado:** completado
- **Resultado:** `imagingRequestPdfService.ts` converge mejor el llenado e impresión de los tres documentos.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** mantenimiento controlado

Justificación:

- El módulo funciona bien.
- Ya recibió los cortes de mayor retorno.
- Seguir mucho más ahora probablemente empezaría a acercarse a consolidación fina más que a necesidad urgente.

---

## 11. Estado deseado después de la ronda

- Runtime del modal lineal.
- Viewer menos denso.
- Service PDF más convergido.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** no de forma inmediata; solo si aparece una necesidad funcional nueva
- **Siguiente módulo sugerido después de este:** Visualizador MMRAD
- **Notas adicionales:** el módulo ya quedó en una zona bastante buena y con mejor separación real entre modal, viewer y PDF runtime.
