# Evaluación de Módulo: Documentos Clínicos

## Metadatos del módulo

- **Módulo:** Documentos clínicos
- **Ruta(s) principal(es):**
  - [src/features/clinical-documents](../src/features/clinical-documents)
  - [src/application/clinical-documents](../src/application/clinical-documents)
- **Fecha de evaluación:** 2026-04-15
- **Evaluador:** Codex
- **Estado general:** verde

---

## 1. Nota global

- **Nota global (1 a 7):** `6.6 / 7`
- **Resumen ejecutivo breve:** módulo fuerte, bien estructurado y mucho más estable que antes, con muy buena cobertura y documentación. La principal limitación sigue siendo la complejidad intrínseca del editor rico y del workspace, no una deuda roja evidente.

---

## 2. Evaluación multiparamétrica

| Dimensión                        | Nota | Comentario                                                                                                   |
| -------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------ |
| Calidad general                  |  6.6 | Muy buen nivel global, con deuda residual controlada.                                                        |
| Estructura                       |  6.8 | La separación por `components / hooks / controllers / domain / services / contracts` está muy bien resuelta. |
| Organización                     |  6.7 | Es un feature grande, pero se navega mejor que el promedio del repo.                                         |
| Buenas prácticas de codificación |  6.7 | Mucha lógica pura en controllers y boundaries razonables.                                                    |
| Coherencia funcional             |  6.5 | El flujo principal está alineado, aunque el editor sigue siendo un frente sensible.                          |
| Separación y límites             |  6.8 | El feature boundary está explícito y soportado por guardrails.                                               |
| Estabilidad                      |  6.4 | Hoy está bastante mejor; el riesgo principal sigue siendo editor/autosave/sync, no caídas abiertas.          |
| Escalabilidad                    |  6.4 | Puede seguir creciendo, pero conviene mantener convergencia y evitar volver a densificar el workspace.       |
| Documentación                    |  6.9 | Tiene README, ADR y runtime note bastante mejores que el promedio del programa.                              |
| Tests                            |  6.8 | Suite propia muy amplia y útil, con cobertura de DOM, reducer, contratos y servicios.                        |

---

## 3. Qué hace bien este módulo

- Tiene una arquitectura interna clara y explícita, con separación fuerte entre UI, hooks, controllers, domain y servicios.
- La cobertura del módulo es muy sólida: `62` archivos de test verdes y `326` tests pasando en la suite propia.
- La feature está bien documentada con:
  - [README.md](../src/features/clinical-documents/README.md)
  - [CLINICAL_DOCUMENT_EDITOR_RUNTIME.md](./CLINICAL_DOCUMENT_EDITOR_RUNTIME.md)
  - [ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](./ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
- La extensibilidad por `documentType` quedó bastante bien orientada por definiciones y normalizadores, en vez de meter `if` ad hoc en la hoja.
- Se saneó bien el frente más delicado del editor:
  - cursor / foco
  - sangrías
  - inserciones HTML/imágenes
  - autosave tardío
  - staging remoto

---

## 4. Hallazgos principales

- El módulo sigue teniendo un editor rico propio sobre `contenteditable`, y eso por definición tiene mayor fragilidad que un formulario simple.
- El costo cognitivo sigue siendo relativamente alto en los archivos centrales del editor/workspace.
- Aunque la UX quedó más estable, todavía hay bastante lógica especializada distribuida entre controller, hook del editor, workspace draft, autosave y sync remoto.

---

## 5. Riesgos actuales

### Riesgo técnico

- Reaparición de bugs sutiles de selección, inserción o historial en el editor rico.
- Densificación futura de los hooks principales si se siguen agregando capacidades sin seguir el patrón actual de controllers puros.

### Riesgo operativo / clínico

- Que un cambio en templates, compatibilidad o sync remoto afecte contenido clínico visible sin romper de inmediato los guardrails globales.
- Que una fuente externa rara de copiado/pegado vuelva a introducir markup extraño no cubierto por los casos habituales.

---

## 6. Hotspots y archivos clave

| Archivo                                                                                                                                   | Rol                                | Riesgo / observación                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| [useClinicalDocumentRichTextEditorController.ts](../src/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController.ts) | Orquestación central del editor    | `399` líneas; sigue siendo el frente más delicado del módulo.          |
| [clinicalDocumentRichTextController.ts](../src/features/clinical-documents/controllers/clinicalDocumentRichTextController.ts)             | Sanitización y transformación HTML | `351` líneas; mucha responsabilidad técnica concentrada.               |
| [useClinicalDocumentsWorkspaceModel.ts](../src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts)                   | Wiring principal del workspace     | `273` líneas; ya está mejor, pero sigue siendo orquestador importante. |
| [useClinicalDocumentSheetState.ts](../src/features/clinical-documents/hooks/useClinicalDocumentSheetState.ts)                             | Estado efímero de la hoja          | `268` líneas; sensible por mezclar editor y shell visual.              |
| [useClinicalDocumentDraftAutosave.ts](../src/features/clinical-documents/hooks/useClinicalDocumentDraftAutosave.ts)                       | Autosave del draft                 | `234` líneas; ya saneado, pero es zona crítica.                        |
| [useClinicalDocumentDraftRemoteSync.ts](../src/features/clinical-documents/hooks/useClinicalDocumentDraftRemoteSync.ts)                   | Sync remoto del draft              | `81` líneas; chico, pero muy sensible por dominio.                     |

---

## 7. Guardrails y checks relevantes

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:clinical-documents`
- `npx eslint .`

Resultado actual:

- **Typecheck:** verde
- **Quality:** verde
- **Tests focalizados del módulo:** `62/62` archivos, `326/326` tests verdes
- **Boundary del feature:** verde dentro de `check:quality`

---

## 8. Deuda técnica priorizada

### P1

- Mantener bajo control la complejidad del editor rico y evitar nuevos bypasses al pipeline unificado.
- Seguir endureciendo los casos de integración real del editor frente a copiado/pegado y cambios estructurales del draft.

### P2

- Bajar un poco más el costo cognitivo del workspace model y del sheet state.
- Seguir consolidando compatibilidad/document-type rules para que nuevas plantillas no reintroduzcan lógica dispersa.

### P3

- Mejorar QA manual dirigida del editor con fuentes reales de Word/PDF/correo/Syslab/MMRAD.
- Afinar detalles visuales/ergonómicos del workspace sin tocar el contrato técnico principal.

---

## 9. Plan de mejoras por bloques

### Bloque 1

- **Objetivo:** seguir consolidando el editor como pipeline único.
- **Cambio esperado:** ningún camino nuevo de inserción/edición debería saltarse controller + normalización + snapshot.
  - **Archivos probables:**
  - [useClinicalDocumentRichTextEditorController.ts](../src/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController.ts)
  - [clinicalDocumentRichTextController.ts](../src/features/clinical-documents/controllers/clinicalDocumentRichTextController.ts)
- **Tests / checks requeridos:** `test:clinical-documents`, `typecheck`, `check:quality`
- **Criterio de cierre:** no quedan bypasses obvios nuevos; cobertura DOM/controller suficiente.

### Bloque 2

- **Objetivo:** bajar más complejidad del workspace sin cambiar UX.
- **Cambio esperado:** más comandos puros fuera de `useClinicalDocumentsWorkspaceModel` y `useClinicalDocumentSheetState`.
  - **Archivos probables:**
  - [useClinicalDocumentsWorkspaceModel.ts](../src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts)
  - [useClinicalDocumentSheetState.ts](../src/features/clinical-documents/hooks/useClinicalDocumentSheetState.ts)
- **Tests / checks requeridos:** suite focalizada del workspace
- **Criterio de cierre:** menos wiring inline y menor costo de lectura.

### Bloque 3

- **Objetivo:** blindar más la persistencia de formato y cambios estructurales.
- **Cambio esperado:** más regresiones para:
  - salir rápido del módulo
  - cambiar de documento
  - cambiar plantilla
  - restaurar template
  - recibir remoto staged
  - **Archivos probables:**
  - [useClinicalDocumentDraftAutosave.ts](../src/features/clinical-documents/hooks/useClinicalDocumentDraftAutosave.ts)
  - [useClinicalDocumentWorkspaceDraft.ts](../src/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft.ts)
  - tests asociados
- **Tests / checks requeridos:** focalizados del draft/autosave/workspace
- **Criterio de cierre:** menor riesgo de pérdida/intermitencia de contenido.

---

## 10. Recomendación de estrategia

- **Estrategia recomendada:** saneamiento focalizado

Justificación:

- El módulo no necesita re-arquitectura grande.
- Ya tiene una base seria y madura.
- Lo que más conviene ahora es seguir reduciendo complejidad residual y blindando estabilidad percibida del editor/workspace.

---

## 11. Estado deseado después de la ronda

- Editor rico estable en uso cotidiano, con menos sorpresas de foco, pegado, autosave y cambios de plantilla.
- Workspace más declarativo y fácil de modificar.
- Contratos de plantillas, compatibilidad y persistencia todavía más explícitos.

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** sí
- **Siguiente módulo sugerido después de este:** Censo diario
- **Notas adicionales:** Documentos clínicos ya está en una zona claramente fuerte del programa; la deuda restante es de refinamiento y control de complejidad, no de crisis arquitectónica.
