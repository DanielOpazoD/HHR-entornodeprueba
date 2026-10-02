# Operative Rules Reference

Guía corta para reglas operativas no obvias que hoy conviene conocer antes de tocar `census`, `handoff`, `CUDYR`, `laboratorio` o la búsqueda global de pacientes.

## Censo y turnos nocturnos

- El badge amarillo de `ingreso` debe pertenecer a un solo turno.
- Un ingreso ocurrido en la madrugada de `X + 1` puede seguir perteneciendo al turno noche de `X`.
- La búsqueda global de paciente (`Ir a censo`) debe abrir el último día en que el episodio estuvo hospitalizado, no la fecha de ingreso.

Referencias:

- `src/application/patient-flow/clinicalEpisode.ts`
- `src/utils/clinicalDayUtils.ts`
- `src/features/census/components/global-search/episodeGroupingController.ts`

## CUDYR nocturno

- El corte nocturno fijo es `01:00` del día siguiente al `record.date`.
- Solo son elegibles pacientes con al menos `8` horas de hospitalización a ese corte.
- Los casos bloqueados siguen visibles, pero no deben sumar cálculo, resumen ni exportación.
- Los perfiles no admin solo editan `X` y `X - 1`; `X - 2` o más antiguo queda en solo lectura.

Referencias:

- `src/features/cudyr/controllers/cudyrEligibilityController.ts`
- `src/features/cudyr/controllers/cudyrEditAccessController.ts`
- `src/services/cudyr/cudyrSummary.ts`
- `src/services/exporters/reportWorkbookBuilders.ts`

## Laboratorio microbiológico

- `Microbiología` se presenta como pestaña separada del visor.
- `Clostridium difficile`, `Coprocultivo`, `Cultivo corriente / Antibiograma`, `PCR panel respiratorio` y `Sedimento/Urocultivo` son exámenes distintos.
- Si Syslab no entrega el detalle microbiológico completo en `details`, el visor debe completar la tarjeta desde el PDF original antes de degradar a “resultado disponible en PDF”.
- La clasificación microbiológica debe resolverse en un controller propio, separado de comparación y tendencias, para evitar mezclar panel viral con cultivo al crecer el análisis.
- Aunque una tarjeta microbiológica todavía no tenga findings hidratados, el controller debe conservar la separación por examen y el `sourceExam` necesario para el fallback posterior desde PDF.
- El post-procesado de resultados de laboratorio (`merge` de bilirrubinas, orden clínico de comparación, orden cronológico de columnas y orden final de microbiología) debe vivir separado del loop principal de findings, para que `labAnalyticsController` siga concentrado en iterar detalles y no vuelva a mezclar ingestión con presentación derivada.
- La recolección de findings (comparación, tendencias, bilirrubinas y ruteo microbiológico) debe vivir en un controller aparte del orquestador principal, para que `labAnalyticsController` pueda mantenerse como ensamblador corto del pipeline.

Referencias:

- `src/features/laboratory/controllers/labAnalyticsController.ts`
- `src/features/laboratory/controllers/labAnalyticsVariableController.ts`
- `src/features/laboratory/controllers/labFindingCollectionController.ts`
- `src/features/laboratory/controllers/labAnalysisResultController.ts`
- `src/features/laboratory/controllers/labMicrobiologyAnalyticsController.ts`
- `src/features/laboratory/services/labMicrobiologyPdfService.ts`
- `src/features/laboratory/hooks/useLabViewer.ts`

## MMRAD

- El copiado estructurado debe entregar `tipo de estudio + fecha`, seguido por `Hallazgos` e `Impresión`.
- Documentos clínicos usa un acceso rápido de rayo para los TAC recientes con el mismo formato de copiado.

Referencias:

- `src/services/radiology/mmradReportSupport.ts`
- `src/components/modals/RadiologyViewerModal.tsx`
- `src/features/clinical-documents/components/ClinicalDocumentMMRADCopyDialog.tsx`

## DailyRecord write path

- El write path de `dailyRecord` debe mantener separadas las decisiones puras de recovery (`changed paths`, `retry origin`, `conflict summary`) del flujo de persistencia real.
- El sync en background hacia `PatientMaster` debe reutilizar builders pequeños para seeds, eventos, patches y payloads de append, en lugar de recomponer esos datos inline por cada rama.
- Los append de ingreso/egreso/traslado y el backfill de ingreso faltante deben resolverse como planes o payloads puros antes de ejecutar efectos, para que el servicio principal solo orqueste llamadas al repositorio.
- La ejecución de esos append debe converger en un helper compartido, para que ingreso, egreso y traslado no vuelvan a divergir en llamadas al repositorio por diferencias accidentales de wiring.

## Reducer de camas

- `bedManagementReducer` debe seguir siendo un patch reducer: builders puros para mutaciones repetidas y un switch orquestador corto, en vez de recomponer patches inline por cada acción.
- Las reglas sensibles como `firstSeenDate`, limpieza clínica al cambiar identidad, UPC y toggles de bloque/cama extra/tipo deben quedar protegidas con tests directos del reducer.

## Handoff médico

- `HandoffMedicalObservationsCell` debe delegar al controller el estado visible de observaciones médicas, incluyendo drafts pendientes y criterios de poda, para que el JSX no reintroduzca lógica de continuidad o vacíos operativos.

Referencias:

- `src/features/handoff/components/HandoffMedicalObservationsCell.tsx`
- `src/features/handoff/controllers/handoffRowCellsController.ts`

## Listas globales de correo del censo

- El hook `useCensusEmailRecipientLists` debe quedar como orquestador: bootstrap, selección activa, mutaciones y fallbacks deben resolverse en controllers puros o casos de uso.
- La política de sync diferido no debe vivir inline en el hook: primero se resuelve si corresponde sincronizar y con qué input, y luego el hook solo dispara el caso de uso con ese plan.
- La restauración de estado bootstrap/local debe resolverse como runtime state puro antes de tocar `setState`, para que el hook aplique una sola transición y no repita wiring local por cada rama.
- Los casos de uso de listas de correo deben traducir validación, fallos de servicio y errores desconocidos con helpers compartidos de outcome, para no duplicar `createApplicationFailed(...)`.
- Los éxitos de mutaciones (`create`, `rename`, `delete`) deben converger también a controllers de runtime pequeños, para que el hook no vuelva a recomponer inline cómo queda la lista activa ni qué estado debe persistirse en `app settings`.

Referencias:

- `src/services/repositories/dailyRecordPatchPersistenceController.ts`
- `src/services/repositories/dailyRecordPersistencePreparation.ts`
- `src/services/repositories/dailyRecordWriteRecoveryController.ts`
- `src/services/repositories/dailyRecordMasterSyncController.ts`
- `src/application/census-email/censusRecipientListUseCases.ts`
- `src/application/census-email/censusRecipientListOutcomeController.ts`
- `src/hooks/controllers/censusEmailRecipientSyncController.ts`

## Scorecard de deuda viva

Para regenerar un snapshot mínimo de hotspots, estabilidad de tests, crecimiento de `firestore.rules` y churn reciente:

```bash
npm run report:maintenance-debt-scorecard
```

- `pendingHotspots` debe reflejar solo excedentes reales contra guardrails activos.
- `watchlist` sigue mostrando archivos densos o de alto churn que conviene seguir iterando aunque ya no estén incumpliendo un límite.

## Firestore rules governance

- `firestore.rules` es un artefacto generado; la edición humana debe ocurrir en `rules/firestore/*.rules`.
- Cada fragmento Firestore debe tener owner, riesgo y razón en `scripts/config/firestore-rules-governance.json`.
- El presupuesto actual del archivo generado es un guardrail explícito, no una invitación a crecer hasta el límite.

Comandos:

```bash
npm run check:firestore-rules-governance
npm run check:security
```
