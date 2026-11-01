# Iterative Quality Execution Plan

Última actualización: 2026-04-09

## Objetivo

Ejecutar de forma iterativa y trazable tres líneas de trabajo priorizadas:

1. volver a verde `npm run check:quality`;
2. redefinir el PIN local como barrera UX y no como control de seguridad fuerte;
3. consolidar entrypoints públicos por feature para bajar acoplamiento y sostener escalabilidad.

## Regla de ejecución

No se inicia una fase nueva hasta cerrar completamente la actual.

Una fase se considera cerrada solo si:

- se completó el alcance definido abajo;
- pasaron los checks de salida de la fase;
- se actualizó el tracker `docs/FOUNDATION_CONTINUATION_TRACKER.md`;
- se actualizó este plan con fecha y nota breve de resultado;
- se dejó commit dedicado con el mensaje sugerido o equivalente.

## Secuencia obligatoria

| Fase  | Estado     | Objetivo principal                                 |
| ----- | ---------- | -------------------------------------------------- |
| `Q00` | completado | dejar plan, tracker y deuda abiertos versionados   |
| `Q01` | completado | recuperar gobernanza y artefactos de calidad       |
| `Q02` | completado | restaurar ownership y boundaries de `census`       |
| `Q03` | completado | romper ciclos de `clinical-documents`              |
| `Q04` | completado | alinear `repo-hygiene` y `domain-hotspot-boundary` |
| `Q05` | completado | consolidar APIs públicas por feature               |
| `Q06` | completado | rebajar el PIN local a barrera UX explícita        |
| `Q07` | completado | corrida final de convergencia y cierre del ciclo   |

## Fase `Q00` - Planificación versionada

### Alcance

- Crear este plan.
- Abrir el ciclo activo en `docs/FOUNDATION_CONTINUATION_TRACKER.md`.
- Registrar la deuda correspondiente en `docs/TECHNICAL_DEBT_REGISTER.md`.

### Archivos

- `docs/ITERATIVE_QUALITY_EXECUTION_PLAN.md`
- `docs/FOUNDATION_CONTINUATION_TRACKER.md`
- `docs/TECHNICAL_DEBT_REGISTER.md`

### Commit sugerido

- `docs: open iterative quality execution cycle`

### Checks de salida

- revisión manual del plan y consistencia entre documentos

## Fase `Q01` - Gobernanza y artefactos de calidad

### Objetivo

Eliminar fallas de configuración, catálogo y artefactos faltantes que hoy impiden confiar en `check:quality`.

### Archivos objetivo

- `scripts/feature-dependency-matrix.json`
- `scripts/config/test-failure-catalog.json`
- `scripts/config/guardrail-governance.json`
- `scripts/check-operational-runbooks.mjs`
- `scripts/check-guardrail-governance.mjs`
- `scripts/report-guardrail-governance.mjs`
- `reports/quality-metrics.md`
- `reports/operational-health.md`
- `reports/system-confidence.md`
- `reports/serverless-sensitive-coverage.md`
- `reports/compatibility-import-governance.md`
- `reports/release-readiness-scorecard.md`
- `reports/release-confidence-matrix.md`
- `reports/serverless-runtime-governance.md`
- `reports/guardrail-governance.md`
- `reports/technical-ownership-map.md`
- `reports/sustainable-change-policy.md`
- `reports/operational-health.json`

### Trabajo esperado

- agregar `laboratory` a la matriz de features;
- corregir referencias obsoletas del catálogo de fallos;
- decidir explícitamente si los artefactos `reports/*` son requeridos en repo o generados por script;
- dejar los checks de gobernanza alineados con esa decisión;
- evitar “placeholders vacíos” si el proyecto ya tiene scripts reales para producir los reportes.

### Commit sugerido

- `chore: restore quality governance artifacts`

### Checks de salida

- `npm run check:feature-dependencies`
- `npm run check:test-failure-catalog`
- `npm run check:guardrail-governance`
- `npm run check:operational-runbooks`

## Fase `Q02` - Ownership y boundaries de `census`

### Objetivo

Cerrar la deuda actual entre `src/hooks/controllers` y `src/features/census/controllers` sin abrir una capa nueva innecesaria.

### Decisión de diseño

El owner canónico debe seguir siendo `src/features/census/controllers`. Los wrappers o shims en `src/hooks/controllers` solo pueden sobrevivir si quedan mínimos, temporales y sin violar boundaries.

### Archivos objetivo

- `src/hooks/controllers/bedManagerGridItemsController.ts`
- `src/hooks/controllers/bedManagerModalController.ts`
- `src/hooks/controllers/censusEmailRecipientsController.ts`
- `src/hooks/controllers/censusMovementDatePresentationController.ts`
- `src/hooks/controllers/clinicalShiftCalendarController.ts`
- `src/hooks/controllers/dischargeModalController.ts`
- `src/hooks/controllers/modalFormController.ts`
- `src/hooks/controllers/moveCopyModalController.ts`
- `src/hooks/controllers/patientMovementCreationController.ts`
- `src/hooks/controllers/patientMovementCreationErrorPresentation.ts`
- `src/hooks/controllers/patientMovementCreationInputController.ts`
- `src/hooks/controllers/patientMovementCreationSharedController.ts`
- `src/hooks/controllers/patientMovementDischargeMutationController.ts`
- `src/hooks/controllers/patientMovementMutationController.ts`
- `src/hooks/controllers/patientMovementRuntimeController.ts`
- `src/hooks/controllers/patientMovementSelectionController.ts`
- `src/hooks/controllers/patientMovementTransferMutationController.ts`
- `src/hooks/controllers/patientMovementUndoController.ts`
- `src/hooks/controllers/patientMovementUndoErrorPresentation.ts`
- `src/hooks/controllers/patientMovementUndoMutationController.ts`
- `src/hooks/controllers/sharedCensusBrowserRuntimeController.ts`
- `src/hooks/controllers/sharedCensusFilesController.ts`
- `src/hooks/controllers/sharedCensusModeController.ts`
- `src/hooks/controllers/timeInputController.ts`
- `src/hooks/controllers/transferModalController.ts`
- `src/features/census/public.ts`
- `src/features/census/index.ts`
- `src/components/layout/date-strip/DateStripQuickActions.tsx`

### Trabajo esperado

- mover imports consumidores a la API canónica del feature;
- reducir o retirar shims si ya no agregan valor;
- corregir el acceso directo a runtime browser reportado por `check:census-runtime-boundary`;
- mantener rollback simple y diffs chicos por lote si hace falta partir la fase en subcommits locales, pero publicar un único commit limpio al cerrar la fase.

### Commit sugerido

- `refactor: restore census controller ownership boundaries`

### Checks de salida

- `npm run check:census-feature-boundary`
- `npm run check:shared-layer-boundary`
- `npm run check:folder-dependencies`
- `npm run check:census-runtime-boundary`

## Fase `Q03` - Romper ciclos de `clinical-documents`

### Objetivo

Eliminar los ciclos reportados por `check:architecture` sin introducir facades cosméticas.

### Archivos objetivo

- `src/application/clinical-documents/clinicalDocumentEditorUseCases.ts`
- `src/application/clinical-documents/clinicalDocumentTemplateUseCases.ts`
- `src/application/clinical-documents/clinicalDocumentUseCases.ts`
- `src/application/ports/clinicalDocumentPort.ts`
- `src/features/clinical-documents/index.ts`
- `src/features/clinical-documents/public.ts`
- `src/features/clinical-documents/components/ClinicalDocumentsModal.tsx`
- `src/features/clinical-documents/components/ClinicalDocumentsWorkspace.tsx`
- `src/features/clinical-documents/components/ClinicalDocumentsSidebar.tsx`
- `src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts`
- `src/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDraft.ts`
- `src/features/clinical-documents/hooks/useClinicalDocumentDraftAutosave.ts`
- `src/features/clinical-documents/hooks/useClinicalDocumentDraftRemoteSync.ts`
- `src/features/clinical-documents/hooks/useClinicalDocumentWorkspaceExportActions.ts`
- `src/features/clinical-documents/hooks/useClinicalDocumentWorkspaceBootstrap.ts`
- `src/features/clinical-documents/controllers/clinicalDocumentWorkspaceController.ts`
- `src/shared/clinical-documents/clinicalDocumentPresentation.ts`
- `src/application/patient-flow/patientAnalysisEngine.ts`
- `src/application/patient-flow/patientAnalysisSupport.ts`

### Trabajo esperado

- mover tipos, presentation helpers o contratos compartidos a un punto neutral;
- evitar que código interno del feature vuelva a entrar por `index.ts` o `public.ts`;
- mantener la API pública del feature solo para consumidores externos.

### Commit sugerido

- `refactor: break clinical documents dependency cycles`

### Checks de salida

- `npm run check:architecture`

## Fase `Q04` - Alineación de hygiene y domain hotspots

### Objetivo

Cerrar imports no canónicos hacia contratos raíz de `dailyRecord` y dejar la surface de dominio consistente con los guardrails.

### Archivos objetivo

- `src/application/shared/dailyRecordBedContracts.ts`
- `src/application/shared/dailyRecordCoreContracts.ts`
- `src/application/shared/dailyRecordMedicalContracts.ts`
- `src/application/shared/dailyRecordStaffContracts.ts`
- `src/features/handoff/components/HandoffCudyrPrintTable.tsx`
- `src/features/handoff/components/handoffCudyrPrintSupport.ts`
- `src/types/domain/dailyRecord.ts`
- `src/application/shared/dailyRecordContracts.ts`

### Trabajo esperado

- migrar imports hacia `@/application/shared/dailyRecordContracts` o facade aprobada;
- dejar `dailyRecord` concentrado en ports/facades y no en consumo directo desde hojas externas.

### Commit sugerido

- `refactor: align daily record imports with canonical contracts`

### Checks de salida

- `npm run check:repo-hygiene`
- `npm run check:domain-hotspot-boundary`

## Fase `Q05` - Consolidación de APIs públicas por feature

### Objetivo

Dejar entrypoints públicos mínimos y explícitos para `census`, `clinical-documents` y `laboratory`, reduciendo imports profundos desde capas compartidas.

### Archivos objetivo

- `src/features/census/public.ts`
- `src/features/census/index.ts`
- `src/features/clinical-documents/public.ts`
- `src/features/clinical-documents/index.ts`
- `src/features/laboratory/public.ts`
- `src/components/layout/date-strip/DateStripQuickActions.tsx`
- consumidores externos que hoy entren por rutas internas del feature

### Trabajo esperado

- revisar que cada `public.ts` exporte solo lo que realmente necesita el resto del repo;
- migrar consumidores a esos entrypoints;
- endurecer los checks existentes sin inventar nuevos si los actuales ya cubren el riesgo.

### Commit sugerido

- `refactor: consolidate feature public entrypoints`

### Checks de salida

- `npm run check:feature-dependencies`
- `npm run check:shared-layer-boundary`
- `npm run check:folder-dependencies`

## Fase `Q06` - PIN local como barrera UX

### Objetivo

Hacer explícito en código, UI y documentación que el PIN local solo protege privacidad casual del puesto y no actúa como control de seguridad fuerte.

### Archivos objetivo

- `src/context/SecurityContext.tsx`
- `src/components/modals/SecuritySettings.tsx`
- `src/components/security/PinLockScreen.tsx`
- `src/tests/context/SecurityContext.test.tsx`
- `src/tests/components/PinLockScreen.test.tsx`
- `docs/system-behaviors.md`
- `README.md`

### Trabajo esperado

- cambiar copy de UI para hablar de “bloqueo rápido local” o equivalente;
- dejar visible que no reemplaza logout, sesión ni permisos;
- evitar reutilización del PIN para decisiones sensibles;
- si se mantiene persistencia local, documentarla como decisión UX deliberada.

### Commit sugerido

- `docs: redefine local pin as privacy ux barrier`

### Checks de salida

- `npm run test:risk:auth`
- `npm run test:risk:admin-health`
- `vitest run src/tests/context/SecurityContext.test.tsx src/tests/components/PinLockScreen.test.tsx`

## Fase `Q07` - Convergencia y cierre

### Objetivo

Ejecutar la validación integral y dejar el ciclo documentado como cerrado.

### Archivos objetivo

- `docs/ITERATIVE_QUALITY_EXECUTION_PLAN.md`
- `docs/FOUNDATION_CONTINUATION_TRACKER.md`
- `docs/TECHNICAL_DEBT_REGISTER.md`

### Commit sugerido

- `docs: close iterative quality execution cycle`

### Checks de salida

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:risk:auth`
- `npm run test:risk:admin-health`

## Registro de progreso

| Fecha      | Fase  | Estado     | Nota                                                                                                                                                                                                                          |
| ---------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-09 | `Q00` | completado | Plan inicial versionado y ciclo abierto                                                                                                                                                                                       |
| 2026-04-09 | `Q01` | completado | Matriz de features, catálogo de fallos y artefactos `reports/*` alineados; checks de salida en verde                                                                                                                          |
| 2026-04-09 | `Q02` | completado | Shims gobernados de `hooks/controllers` aceptados por guardrail y runtime de `sharedCensus` migrado a adapter                                                                                                                 |
| 2026-04-09 | `Q03` | completado | Los casos de uso de `clinical-documents` dejaron de reingresar por la API pública del feature, `patient-flow` concentra el tipo `Conflict` en el engine y `check:architecture` + `typecheck` quedaron en verde                |
| 2026-04-09 | `Q04` | completado | `handoff` ya consume `DailyRecord` desde contratos canónicos de aplicación, `dailyRecordCoreContracts` quedó explicitado como facade permitida y `repo-hygiene` reconoce a los colaboradores internos de `clinical-documents` |
| 2026-04-09 | `Q05` | completado | `clinical-documents` expone un entrypoint interno explícito para `application/shared` y `laboratory` ya ofrece root barrel                                                                                                    |
| 2026-04-09 | `Q06` | completado | El PIN local quedó presentado como bloqueo rápido de privacidad del dispositivo, la UI ya aclara que no reemplaza auth/permisos y las suites focalizadas más `test:risk:*` quedaron en verde                                  |
| 2026-04-09 | `Q07` | completado | `runtime-adapter-boundary`, `typecheck` y `check:quality` quedaron en verde; el ciclo quedó convergido sin excepciones activas de debt en guardrails                                                                          |

## Ciclo `R00-R06`

### Objetivo

Subir la confianza operativa del repo sin re-arquitectura: cerrar el desalineamiento entre guardrails y reportes, recuperar cobertura crítica en `clinical-documents`, restaurar budgets de flujo y dejar la deuda residual acotada a boundaries y hotspots concretos.

### Ventana temporal

- Día 1: `R00`
- Día 2-3: `R01`
- Día 4: `R02`
- Día 5: `R03`
- Día 6: `R04`
- Día 7: `R05` + arranque de `R06`
- Si `R06` no cierra el Día 7, continúa solo `R06` hasta converger

### Baseline real del ciclo

- `npm run check:quality`: `ok`
- `npm run check:docs-drift`: `ok`
- `npm run check:critical-coverage`: `ok`
- `npm run check:flow-performance-budget`: `ok`
- `reports/system-confidence.json`: `overallStatus=ok`
- convergencia reportada en `reports/quality-metrics.json`: `featureBoundaryViolations=0`, `dailyRecordBoundaryViolations=0`

### Fases y checks

| Fase  | Estado     | Objetivo                                                                 | Checks de salida                                                                                | Commit sugerido                                         |
| ----- | ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `R00` | completado | abrir ciclo, registrar baseline y dejar tracker/debt alineados           | revisión manual de consistencia documental                                                      | `docs: reopen iterative execution cycle`                |
| `R01` | completado | volver a verde `src/features/clinical-documents` en cobertura crítica    | `npm run test:coverage:critical`, `npm run check:critical-coverage`                             | `test: restore clinical documents critical coverage`    |
| `R02` | completado | cerrar residual de boundaries reportado por `quality-metrics`            | checks de boundary afectados, `npm run check:quality`                                           | `chore: align quality metrics with boundary governance` |
| `R03` | completado | reparar drift documental y de artefactos canónicos                       | `npm run check:docs-drift`, regeneración de `technical-execution-baseline`                      | `docs: restore canonical report artifacts`              |
| `R04` | completado | restaurar budgets operativos de flujo y evitar reuse accidental del host | `npm run test:e2e:flow-performance`, `npm run check:flow-performance-budget`                    | `test: restore flow performance budget artifact`        |
| `R05` | completado | reducir hotspots de alto retorno sin tocar contratos públicos            | `npm run typecheck`, `npm run lint`, tests focalizados del hotspot tocado                       | `refactor: reduce high-value hotspots`                  |
| `R06` | completado | convergencia final y cierre documental del ciclo                         | `npm run ci:pre-merge` mínimo; `npm run ci:merge-gate` si el alcance final toca runtime crítico | `docs: close iterative execution cycle r00-r06`         |

### Regla operativa

- No se inicia una fase nueva hasta cerrar completamente la actual.
- Cada jornada empieza revisando tracker + artefactos canónicos.
- Cada jornada termina actualizando `docs/FOUNDATION_CONTINUATION_TRACKER.md`, este plan y la deuda afectada.
- Si una fase se desliza, el calendario se mueve; la secuencia no.

### Historial de avance `R00-R06`

| Fecha      | Fase  | Estado     | Nota                                                                                                                                                                                             |
| ---------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-09 | `R00` | completado | Baseline real confirmado con `check:quality` y `check:docs-drift`; se reabre el ciclo con foco en artifacts y deuda focalizada                                                                   |
| 2026-04-09 | `R01` | completado | `ClinicalDocumentLabInsertDialog` suma cobertura dirigida y `clinical-documents` vuelve a `PASS` en `critical-coverage`                                                                          |
| 2026-04-09 | `R03` | completado | `reports/technical-execution-baseline.{md,json}` se regeneran y desaparece el drift por reporte faltante                                                                                         |
| 2026-04-09 | `R04` | completado | `flow-performance` se vuelve medible en puerto aislado; el menú clásico de acciones clínicas queda delimitado y los accesos clínicos duplicados se consolidan en Honu mientras los budgets pasan |
| 2026-04-09 | `R02` | completado | `report-quality-metrics` se alinea con la misma gobernanza que `check:repo-hygiene`; el residual de boundaries baja a `0`                                                                        |
| 2026-04-09 | `R05` | completado | se extrajeron seams pequeñas en `patient-row` orbital runtime e `indexedDbCore`; `typecheck`, `lint`, tests focalizados y hook hotspots quedaron en verde                                        |
| 2026-04-09 | `R06` | completado | `ci:pre-merge`, checks restantes de `ci:merge-gate`, `check:docs-drift` y reportes canónicos quedaron en verde; ciclo `R00-R06` cerrado                                                          |

### Seguimiento post-cierre 2026-04-19

- Se revalidó el cierre con evidencia fresca y artefactos regenerados:
  - `npm run ci:pre-merge`
  - `npm run ci:preview-gate`
  - `npm run check:flow-performance-budget`
  - `npm run report:governance-snapshots`
  - `npm run report:maintenance-debt-scorecard`
- `reports/system-confidence.json` volvió a `overallStatus=ok`.
- `reports/release-readiness-scorecard.json` volvió a `overall=ok`.
- `reports/operational-health.json` reporta:
  - `flowPerformance.status=passing`
  - `frontendStartup.status=ok`
  - `frontendStartup.previewGate.status=ok`
- El residual operativo queda fuera de gates y explícito como watchlist de mantenimiento:
  - `firestore.rules`
  - `src/hooks/useCensusEmailRecipientLists.ts`
