# Documentos Clínicos

## Arquitectura

- `components/`: shell visual del workspace, hoja clínica y renderers especializados por sección.
- `hooks/`: bootstrap remoto, draft/autosave, exportación y estado UI efímero de la hoja.
- `controllers/`: reglas puras de compatibilidad, validación, secciones, rich text y permisos.
- `domain/`: entidades, templates, definiciones por tipo documental y versión de esquema.
- `services/`: impresión, exportación PDF y sincronización con infraestructura.
- `contracts/`: validación runtime de documentos y templates.

## Decision Guide

- Contrato del workspace y extensibilidad: [docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](../../../docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
- Nota de arquitectura del feature: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Flujo principal

1. `useClinicalDocumentWorkspaceBootstrap` carga templates y subscribe documentos por episodio.
2. `useClinicalDocumentWorkspaceDraft` hidrata documentos legacy al esquema actual, mantiene draft local y resuelve conflictos remotos.
3. `ClinicalDocumentSheet` compone subcomponentes puros y usa `useClinicalDocumentSheetState` para estado UI no persistente.
4. `useClinicalDocumentWorkspaceDocumentActions` crea y elimina borradores.
5. `useClinicalDocumentWorkspaceExportActions` imprime y exporta PDF.
6. Repositorio y templates validan contratos runtime antes de devolver o persistir datos.

## Draft, autosave y compatibilidad

- Todo documento nuevo se crea con `schemaVersion` actual.
- Documentos antiguos se hidratan por `hydrateLegacyClinicalDocument`.
- Todo documento/template leído o persistido pasa por contratos runtime.
- El reducer del draft separa:
  - edición local
  - base persistida
  - actualización remota pendiente como estado interno no visible
  - estado de autosave
- `lastPersistedSnapshotRef` sigue siendo el punto de comparación para detectar cambios locales.
- La resolución de carga remota y la persistencia del editor pasan por use cases de aplicación.
- UX no deseada: el módulo no debe volver a mostrar avisos o acciones manuales de conflicto remoto
  como "Actualización remota pendiente", "Recargar remoto" o "Descartar local". La hoja debe mantener
  el borrador local visible y resolver la sincronización por el flujo interno/autosave.

## Tipos documentales y secciones especiales

- `domain/definitions.ts` define el comportamiento por `documentType`.
- Cada definición puede declarar:
  - `sectionRenderers`
  - `sectionNormalizers`
  - `sectionValidators`
  - `printOptions`
- Las secciones especiales no deben agregarse con `if` en la hoja; deben registrarse en la definición del documento.
- La integridad del registry debe validarse con tests dedicados.

## Integraciones rápidas del sidebar

- El sidebar del workspace puede exponer atajos clínicos contextuales junto al nombre del paciente.
- `LAB` mantiene el flujo de inserción resumida hacia el documento activo y debe insertar en la
  sección editora activa; si no hay sección activa válida, cae a la primera sección visible.
- El atajo con icono de rayo (`MMRAD`) abre un mini-dialog para estudios `CT` de los últimos 30 días.
- Ese mini-dialog solo aparece cuando existe documento activo editable y usa el mismo backend MMRAD del modal principal.
- El texto copiado de MMRAD debe seguir este formato:
  - `TAC de <zona anatómica> (DD-MM-YYYY).`
  - `Hallazgos: ...`
  - `Impresión: ...`
- El parser de MMRAD debe limpiar firma, footer y scripts antes de exponer `Hallazgos` / `Impresión`.

## Impresión y exportación

- `clinicalDocumentPrintDomSanitizer`: limpia la hoja para impresión.
- `clinicalDocumentPrintHtmlBuilder`: construye el HTML imprimible.
- `clinicalDocumentBrowserPrintService`: abre impresión desde la misma página.
- `clinicalDocumentPdfRenderService`: orquesta render backend y fallback snapshot.
- `clinicalDocumentPdfSnapshotSupport`: encapsula el frame aislado y el snapshot DOM->PDF.
- `clinicalDocumentPdfBinarySupport`: concentra conversión `Blob <-> base64/pdf`.
- Los resultados esperados de exportación/impresión deben resolverse con outcomes tipados y
  notices compartidos; errores recuperables de Drive no deben volver a salir como excepciones
  “normales” dentro del workspace.
- El status de Drive debe diferenciar pendiente, exportado con enlace disponible y fallo recuperable
  con reintento visible.
- `useClinicalDocumentWorkspaceDocumentActions` debe tratar outcomes fallidos como estado esperado:
  crear y eliminar no deben depender de `throw` para informar bloqueos o
  degradaciones recuperables al usuario.

## Invariantes

- `sections` siempre se ordenan por `order`.
- Estados legacy firmados deben hidratarse como borradores editables antes de salir del repositorio.
- `footerMedicoLabel`, `footerEspecialidadLabel` y `patientInfoTitle` nunca deben quedar vacíos tras hidratar/persistir.
- Nuevas migraciones deben pasar por el controlador de compatibilidad, no por parches ad hoc en componentes.

## Checks del feature

- `npm run test:clinical-documents`
- `npm run check:clinical-documents`
- Nota de arquitectura en [ARCHITECTURE.md](./ARCHITECTURE.md)

## Runtime boundaries

- El consumo externo UI debe entrar por `@/features/clinical-documents` o `@/features/clinical-documents/public`.
- `application` y `shared` pueden usar `@/features/clinical-documents/internal` cuando necesiten
  contratos o helpers del feature sin reingresar por componentes UI.
- Los deep imports hacia `components/`, `services/`, `hooks/` o `controllers/` desde fuera de la
  feature están prohibidos y quedan cubiertos por tests de gobernanza estática.
- La hoja principal no debe recuperar `if` especiales por `documentType`; la extensibilidad entra por definiciones/section renderers.
- Todo documento/template leído o persistido debe pasar por contratos runtime antes de salir del repositorio.
- La impresión/exportación debe reportar fallos por telemetría operativa y no depender de logs sueltos.
- Los errores de Drive recuperables deben salir con `userSafeMessage` y degradar a feedback visible,
  no romper el workspace por excepciones sin clasificar.
- Fechas visibles del workspace, sidebar y nombres de PDF deben reutilizar presentation helpers
  compartidos; no deben reaparecer variantes locales de fecha u origen documental en controllers.
- La fecha visible del nombre de PDF debe salir del helper compartido del feature; no se debe
  volver a formatear inline según origen (`finf`, `sourceDailyRecordDate`, `audit.updatedAt`).
- Los servicios del feature que lean/escriban settings remotos deben consumir puertos/runtime adapters
  inyectables; `defaultFirestoreRuntime` no debe reaparecer como dependencia directa del feature.
- `check:repo-hygiene` bloquea imports profundos nuevos desde fuera de la feature para que
  `application` y `shared` dependan solo del entrypoint público.

## Test entrypoints recomendados

- `npm run test:clinical-documents`
- `npx vitest run src/tests/features/clinical-documents src/tests/services/repositories/ClinicalDocumentRepository.test.ts`

## Safe change links

- [docs/QUALITY_GUARDRAILS.md](../../../docs/QUALITY_GUARDRAILS.md)
- [docs/SAFE_CHANGE_CHECKLIST.md](../../../docs/SAFE_CHANGE_CHECKLIST.md)
- [docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](../../../docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md)
