# Cleanup Inventory 2026-04-19

## Objetivo

Inventario previo a cualquier eliminacion de codigo, documentacion o tests. Este documento no autoriza borrados automaticos; solo clasifica candidatos con evidencia local y sugiere la verificacion minima para una ola de limpieza segura.

## Baseline usado

- `npm run check:docs-drift` -> OK
- `npm run typecheck` -> OK
- `npm run check:quality` -> OK
- `npm run test:ci:unit` -> OK
- `reports/quality-metrics.md` y `reports/maintenance-debt-scorecard.md` refrescados en `HEAD`

## Metodologia

1. Buscar archivos fuente sin inbound references estaticas desde `src`, excluyendo tests y reportes generados.
2. Revisar referencias dinamicas y wiring especial para separar falsos positivos.
3. Buscar documentacion con drift formal y, aparte, documentos historicos o no enlazados.
4. Detectar pares de suites de test con el mismo basename o assertions claramente solapadas.

## Hallazgos ejecutivos

- No aparecio drift formal de documentacion: `check:docs-drift` sigue verde.
- Si aparecio una superficie amplia de candidatos no alcanzados estaticamente; varios son falsos positivos por `Worker`, functions o barrels, pero quedan algunos candidatos reales de bajo riesgo.
- La mayor bolsa de deuda documental no parece ser "rota", sino historica o de baja encontrabilidad.
- No hay flakes, megatests ni `.skip`, pero si hay pares de suites con solapamiento suficiente para justificar una consolidacion puntual.

## Falsos positivos ya detectados

Estos archivos no deben entrar a una ola de borrado solo por el scan de alcanzabilidad:

| Archivo                                | Evidencia                                                                                              | Motivo                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `src/services/email/gmailClient.ts`    | consumido por `netlify/functions/send-census-email.ts` y `netlify/functions/send-fuga-notification.ts` | uso real fuera de `src`                                   |
| `src/services/admin/audit.worker.ts`   | instanciado por `src/hooks/controllers/auditWorkerAdapter.ts` via `new Worker(new URL(...))`           | wiring especial no detectado por import scan              |
| `src/context/ConfirmDialogContext.tsx` | `useConfirmDialog` activo vive en `src/context/UIContext.tsx`                                          | el nombre genera confusiones, pero el seam en uso es otro |

## Candidatos de codigo aparentemente muerto o de muy baja alcanzabilidad

### Lote A: baja evidencia de uso, riesgo bajo o medio-bajo

| Archivo                                                              | Evidencia local                                                                                                                           | Riesgo     | Verificacion minima                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `src/utils/publicCensusToken.ts`                                     | `rg` no encontro referencias fuera del propio archivo ni en `docs` utiles; solo aparece en docs API generadas                             | bajo       | `npm run typecheck`, `npm run check:quality`                                                 |
| `src/features/transfers/components/internal/TransferStatusBadge.tsx` | sin referencias fuera del archivo; solo aparece en `src/tests/build/chunkingPolicy.test.ts` como path de chunking                         | bajo       | `npx vitest run src/tests/build/chunkingPolicy.test.ts`, `npm run typecheck`                 |
| `src/features/admin/components/AuditPagination.tsx`                  | `rg` no encontro imports del componente; la paginacion activa hoy vive como logica en `useAuditData`/`auditDataPolicyController`          | medio-bajo | `npx vitest run src/tests/services/admin src/tests/features/admin`, `npm run typecheck`      |
| `src/features/admin/components/CensusAccessManager.tsx`              | sin referencias fuera del archivo                                                                                                         | medio-bajo | `npx vitest run src/tests/features/admin`, `npm run typecheck`                               |
| `src/features/admin/components/AITelemetryPanel.tsx`                 | sin referencias fuera del archivo                                                                                                         | medio-bajo | `npx vitest run src/tests/features/admin`, `npm run typecheck`                               |
| `src/context/ConfirmDialogContext.tsx`                               | no tiene imports desde app; los consumers reales importan `useConfirmDialog` desde `UIContext` o `context/index` que delega a `UIContext` | medio      | `npx vitest run src/tests/context src/tests/hooks src/tests/components`, `npm run typecheck` |

### Lote B: candidatos reales, pero de riesgo medio o alto

| Archivo                                                    | Evidencia local                                                                                                                    | Riesgo     | Motivo de cautela                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `src/services/integrations/fhir/FhirMappingService.ts`     | no aparecio consumo desde app; solo test focalizado `src/tests/integrations/fhir/fhirMapping.test.ts`                              | medio-alto | area de interoperabilidad; puede estar reservada para uso externo o futuro                                   |
| `src/services/interop/fhirService.ts`                      | scan sin inbound refs; coexistencia con el mapper FHIR anterior sugiere duplicacion/prototipo                                      | medio-alto | convive con utilidades `src/services/utils/fhirMappers.ts`; requiere decidir fuente canonica antes de borrar |
| `src/services/terminology/diagnosisAbbreviations.ts`       | sin inbound refs detectados                                                                                                        | medio      | puede ser soporte preparado para NLP/AI o import dinamico futuro                                             |
| `src/services/terminology/nlpPreprocessor.ts`              | sin inbound refs detectados                                                                                                        | medio      | misma razon anterior                                                                                         |
| `src/hooks/controllers/*` varios shims de census/movements | muchos archivos quedaron sin inbound refs desde `src`, pero el repo ya documenta que algunos existen como compatibilidad historica | alto       | auditar contra `src/features/census/README.md` antes de eliminar uno solo                                    |

## Documentacion: candidatos de archivo historico o baja encontrabilidad

### Señal objetiva

- `npm run check:docs-drift` paso.
- Un scan simple de referencias locales entre archivos Markdown, excluyendo `docs/api`, dejo `43` documentos sin enlaces internos detectables.
- Esto no prueba que esten mal, pero si los convierte en buenos candidatos para archivado, indice o consolidacion.

### Candidatos prioritarios de archivado o reubicacion

| Archivo o patron                                                    | Evidencia local                                                              | Riesgo | Recomendacion                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `docs/*_PHASE3_README.md`                                           | varios documentos puntuales de fase sin enlaces internos detectables         | bajo   | mover a carpeta `archive/` o index historico                      |
| `docs/MODULE_EVALUATION_*.md`                                       | evaluaciones puntuales, no enlazadas entre docs activas                      | bajo   | consolidar en un indice de evaluaciones o archivar                |
| `docs/QUARTERLY_MAINTENANCE_TRACKER.md`                             | fuerte contenido historico/completado; no enlazado por otras docs detectadas | bajo   | conservar, pero mover a historico si ya no es tracker activo      |
| `docs/MAINTAINABILITY_EXECUTION_BASELINE.md`                        | snapshot de baseline, sin enlaces internos detectados                        | bajo   | archivar o resumir en el debt register                            |
| `docs/TECHNICAL_APPLICATION_AUDIT.md` y `docs/EVALUATION_RUBRIC.md` | artefactos de evaluacion ejecutiva, baja encontrabilidad                     | bajo   | mantener solo si se usan como referencia vigente; si no, archivar |

### Notas

- `docs/api/` mete mucho ruido en cualquier grep de stale/deprecated. En futuras olas conviene excluirlo siempre de inventarios manuales.
- En esta fase no aparecio evidencia de comandos rotos o runbooks desalineados.

## Tests: candidatos de consolidacion

### Señal objetiva

- `rg -n "describe\\(|it\\(" src/tests | wc -l` -> `7294` bloques de test
- `rg -n "same setup marker" src/tests` -> sin resultados
- No hay duplicados exactos obvios por marcador, pero si pares con el mismo basename y overlap funcional.

### Candidatos prioritarios

| Suites                                                                                                                                        | Evidencia local                                                                                                                                                            | Riesgo     | Recomendacion                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `src/tests/views/census/useCensusPromptState.test.ts` y `src/tests/hooks/useCensusPromptState.test.ts`                                        | comparten al menos dos casos literalmente equivalentes: `ignores current-day-only local store writes` y `reloads prompt state when another day changes in the local store` | medio-bajo | conservar la suite mas fuerte y extraer helper compartido o eliminar el duplicado de menor señal |
| `src/tests/views/census/censusEmailRecipientsController.test.ts` y `src/tests/hooks/censusEmailRecipientsController.test.ts`                  | ambas cubren normalizacion/legacy/sanitizacion del mismo controlador                                                                                                       | medio      | mapear por caso antes de borrar; probablemente consolidable                                      |
| `src/tests/views/handoff/handoffViewController.test.ts` y `src/tests/features/handoff/handoffViewController.test.ts`                          | misma superficie nominal, pero una suite es agregada y la otra valida helpers mas finos                                                                                    | medio      | no borrar de inmediato; primero separar que casos son de API publica vs helpers internos         |
| `src/tests/hooks/dailyRecordSyncNotificationController.test.ts` y `src/tests/hooks/controllers/dailyRecordSyncNotificationController.test.ts` | mismo basename en dos capas                                                                                                                                                | medio      | revisar si una suite quedo como shim historico                                                   |
| `src/tests/services/firebaseEnvironmentPolicy.test.ts` y `src/tests/services/firebase-runtime/firebaseEnvironmentPolicy.test.ts`              | mismo basename bajo dos ubicaciones                                                                                                                                        | medio      | decidir ubicacion canonica de runtime policy y mover o consolidar                                |

## Orden recomendado para la Fase 3

1. Borrar primero `src/utils/publicCensusToken.ts`.
2. Auditar y retirar componentes UI aislados sin refs: `TransferStatusBadge`, `AuditPagination`, `CensusAccessManager`, `AITelemetryPanel`.
3. Consolidar el par `useCensusPromptState` porque tiene el solapamiento mas claro y de menor riesgo.
4. Pasar luego a archivado de docs historicas por patron (`*_PHASE3_README.md`, `MODULE_EVALUATION_*.md`).
5. Dejar FHIR, terminology y shims de census para una ola separada con revision mas fina.

## Comandos de soporte usados en esta fase

```bash
npm run check:docs-drift
rg -n "TODO|deprecated|legacy|obsolete|no usar|old flow" docs src/README.md src/features src/services
rg -n "import\\(|React\\.lazy\\(|\\blazy\\(" src
rg -n "describe\\(|it\\(" src/tests
```

## Conclusion

La fase confirma que el repo no esta "podrido", pero si tiene una capa importante de artefactos historicos y seams de compatibilidad que ya merecen poda controlada. El mejor retorno inmediato esta en candidatos pequenos con evidencia fuerte de no uso y en consolidar un puñado de suites con solapamiento real.
