# Evaluación de Módulo: Visualizador MMRAD

## Metadatos del módulo

- **Módulo:** Visualizador MMRAD
- **Ruta(s) principal(es):**
  - [src/features/radiology/components/RadiologyViewerModal.tsx](../src/features/radiology/components/RadiologyViewerModal.tsx)
  - [src/features/radiology/components/RadiologyViewerModalContent.tsx](../src/features/radiology/components/RadiologyViewerModalContent.tsx)
  - [src/features/radiology/services/mmradService.ts](../src/features/radiology/services/mmradService.ts)
  - [src/domain/radiology/mmradReportSupport.ts](../src/domain/radiology/mmradReportSupport.ts)
  - [netlify/functions/mmrad-search.ts](../netlify/functions/mmrad-search.ts)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.7 / 7`
- **Resumen ejecutivo breve:** módulo fuerte, útil y clínicamente bien aterrizado. La combinación entre búsqueda MMRAD, parsing estructurado del informe y acciones de UI está bastante madura. Tras la ronda actual, el shell del modal y el content principal quedaron más declarativos al sacar helpers puros para pacientes, modalidades, filtros, mensajes vacíos, badges y estado de examen; su principal límite ya no es un runtime tan mezclado, sino la densidad residual del content visual compartido.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                                           |
| -------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------- |
| Calidad general                  |  6.7 | Frente sólido, con señal técnica buena tanto en UI como en parsing/búsqueda backend.                                 |
| Estructura                       |  6.7 | La estructura es más clara ahora que modal y content delegan parte del runtime a controllers puros.                  |
| Organización                     |  6.7 | Se deja seguir bien: modal, content, service y support están bastante diferenciados.                                 |
| Buenas prácticas de codificación |  6.7 | Mejoró al sacar selección, filtros, badges y mensajes vacíos fuera del JSX principal.                                |
| Coherencia funcional             |  6.8 | El flujo completo de búsqueda, filtrado, PDF, DICOM y copiado estructurado se siente coherente.                      |
| Separación y límites             |  6.6 | `RadiologyViewerModal.tsx` mejoró bastante; la mayor densidad residual ya está en `RadiologyViewerModalContent.tsx`. |
| Estabilidad                      |  6.6 | La batería focalizada está verde y cubre tanto frontend como Netlify/parsing.                                        |
| Escalabilidad                    |  6.5 | Puede crecer mejor ahora que filtros y shell del modal ya tienen seams chicos y testeables.                          |
| Documentación                    |  6.4 | Hay soporte documental transversal, aunque no un README específico del módulo como tal.                              |
| Tests                            |  6.8 | Buena señal: modal content, controllers nuevos, report support y netlify search están blindados con tests útiles.    |

---

## 3. Qué hace bien este módulo

- Tiene buen soporte puro para parsing y copiado clínico:
  - [mmradReportSupport.ts](../src/domain/radiology/mmradReportSupport.ts)
- La ronda actual dejó seams puros útiles para el shell del visor:
  - [radiologyViewerModalController.ts](../src/features/radiology/controllers/radiologyViewerModalController.ts)
  - [radiologyViewerContentController.ts](../src/features/radiology/controllers/radiologyViewerContentController.ts)
- El servicio de frontend hacia Netlify está razonablemente delgado:
  - [mmradService.ts](../src/features/radiology/services/mmradService.ts)
- El backend de búsqueda MMRAD está cubierto con una batería útil:
  - [mmradSearch.test.ts](../src/tests/netlify/mmradSearch.test.ts)
- El modal expone acciones reales de alto valor:
  - abrir PDF
  - abrir DICOM HTML5
  - copiar informe estructurado

---

## 4. Hallazgos principales

- La parte más fuerte del módulo no está en el shell visual, sino en el soporte estructurado:
  - parsing del HTML del informe
  - normalización de report URLs
  - clipboard text clínico
- La pieza más pesada del shell ya bajó bastante al sacar helpers de pacientes, modalidades, rangos y keys:
  - [RadiologyViewerModal.tsx](../src/features/radiology/components/RadiologyViewerModal.tsx)
- `RadiologyViewerModalContent.tsx` está bien descompuesto por subcomponentes exportados, pero el archivo aún es el hotspot principal por densidad visual.
- La integración entre UI y búsqueda MMRAD está bien resuelta, y ahora el modal principal mezcla menos state orchestration que al inicio de la evaluación.

---

## 5. Riesgos actuales

### Riesgo técnico

- Seguir agregando más variantes visuales dentro de `RadiologyViewerModalContent.tsx` sin abrir más seams pequeños.
- Volver a mezclar en el modal principal reglas de filtros, modalidades o deduplicación de pacientes que ahora ya tienen hogar claro.

### Riesgo operativo / clínico

- Regresiones en:
  - copiado estructurado del informe
  - normalización de links RIS
  - fallback de errores del search backend
  - acciones PDF / DICOM visibles al usuario

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                           | Rol                             | Riesgo / observación                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| [src/features/radiology/components/RadiologyViewerModal.tsx](../src/features/radiology/components/RadiologyViewerModal.tsx)                                               | Modal principal / runtime shell | `274` líneas; quedó más lineal después de extraer filtros, modalidades, pacientes y keys.     |
| [src/features/radiology/components/RadiologyViewerModalContent.tsx](../src/features/radiology/components/RadiologyViewerModalContent.tsx)                                 | Shell visual y subcomponentes   | `370` líneas; sigue siendo el hotspot principal por densidad visual y branching de contenido. |
| [src/features/radiology/controllers/radiologyViewerModalController.ts](../src/features/radiology/controllers/radiologyViewerModalController.ts)     | Runtime modal puro              | `96` líneas; seam nuevo y valioso para selección de pacientes, tabs y filtros.                |
| [src/features/radiology/controllers/radiologyViewerContentController.ts](../src/features/radiology/controllers/radiologyViewerContentController.ts) | View-model visual puro          | `37` líneas; concentra badges, mensajes vacíos y estado por examen.                           |
| [src/domain/radiology/mmradReportSupport.ts](../src/domain/radiology/mmradReportSupport.ts)                                                   | Parsing / copiado / print HTML  | `209` líneas; fuerte y útil, aunque ya es un soporte importante por sí mismo.                 |
| [src/features/radiology/services/mmradService.ts](../src/features/radiology/services/mmradService.ts)                                                               | Cliente frontend de búsqueda    | `74` líneas; bastante razonable y delgado.                                                    |

---

## 7. Guardrails y checks relevantes

- `npx vitest run src/tests/components/modals/RadiologyViewerModalContent.test.tsx src/tests/services/radiology/mmradReportSupport.test.ts src/tests/netlify/mmradSearch.test.ts src/tests/components/radiologyViewerModalController.test.ts src/tests/components/radiologyViewerContentController.test.ts`

Resultado actual después de la ronda de mejoras:

- **Suite focalizada de MMRAD:** `5/5` archivos verdes, `22/22` tests OK
- No aparece hoy un boundary check dedicado del módulo.
- `npm run typecheck` quedó verde
- `npm run check:quality` quedó verde

---

## 8. Deuda técnica priorizada

### P1

- Bajar algo más de densidad visual en `RadiologyViewerModalContent.tsx`.

### P2

- Mantener en controllers cualquier nueva política de badges, estados vacíos o tabs antes de volver a cargar el JSX principal.

### P3

- Mantener blindado el parsing/copiado si RIS cambia markup o links inline.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Objetivo:** hacer más declarativo el runtime del modal.
- **Cambio ejecutado:** extraer `radiologyViewerModalController.ts` para pacientes únicos, modalidades, filtros, rangos y keys de examen.
- **Archivos tocados:**
  - [src/features/radiology/components/RadiologyViewerModal.tsx](../src/features/radiology/components/RadiologyViewerModal.tsx)
  - [src/features/radiology/controllers/radiologyViewerModalController.ts](../src/features/radiology/controllers/radiologyViewerModalController.ts)
- **Criterio de cierre:** logrado; el modal principal quedó más lineal y con menos branching visible.

### Bloque 2

- **Objetivo:** bajar densidad de `RadiologyViewerModalContent.tsx`.
- **Cambio ejecutado:** extraer `radiologyViewerContentController.ts` para badges, availability, conteos por modalidad y mensajes vacíos.
- **Archivos tocados:**
  - [src/features/radiology/components/RadiologyViewerModalContent.tsx](../src/features/radiology/components/RadiologyViewerModalContent.tsx)
  - [src/features/radiology/controllers/radiologyViewerContentController.ts](../src/features/radiology/controllers/radiologyViewerContentController.ts)
- **Criterio de cierre:** logrado; el content quedó algo más declarativo sin fragmentar de más la UI.

### Bloque 3

- **Objetivo:** frenar antes de sobreingeniar.
- **Cambio esperado:** no seguir podando salvo que aparezca dolor real en `RadiologyViewerModalContent.tsx` o en el soporte MMRAD.
- **Archivos probables:**
  - [src/features/radiology/components/RadiologyViewerModalContent.tsx](../src/features/radiology/components/RadiologyViewerModalContent.tsx)
  - [src/domain/radiology/mmradReportSupport.ts](../src/domain/radiology/mmradReportSupport.ts)
- **Criterio de cierre:** conservar el módulo estable y mover el foco al siguiente módulo del inventario.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** mejora ligera con foco en runtime del modal

Justificación:

- El módulo ya tiene una base bastante buena.
- No necesita rescate estructural.
- La ronda quirúrgica principal ya se hizo y dejó el módulo en una zona madura; seguir ahora solo conviene si aparece dolor real.

---

## 11. Estado deseado después de la ronda

- Modal principal más lineal.
- Content visual algo más declarativo.
- Soporte MMRAD puro mantenido estable.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** no de forma prioritaria; conviene pasar al siguiente módulo salvo que aparezca un bug real
- **Siguiente módulo sugerido después de este:** Sección de búsqueda
- **Notas adicionales:** el punto fuerte del módulo sigue estando más en el soporte clínico y backend que en el shell visual; la ronda actual corrigió justo el shell que más convenía tocar.
