# Foundation Continuation Tracker

> **Histórico:** cierre documentado al 2026-04-19. Los porcentajes, estados y
> recomendaciones siguientes pertenecen a ese ciclo; no describen el commit actual.
> Consultar [estado verificable](../PROJECT_STATUS.md) y
> [cadencia vigente](FOUNDATION_MAINTENANCE_CADENCE.md) para nuevas decisiones.

Última actualización: 2026-04-19

## Resumen

- Ciclo activo: ninguno (`R00-R06` cerrado)
- Tareas resueltas o no requeridas: `7/7`
- Estado global del ciclo: `cerrado`

## Regla activa

- No se inicia una fase nueva hasta cerrar completamente la actual.
- Toda fase cerrada debe dejar commit dedicado, tracker actualizado y checks de salida en verde.

## Estado actual del ciclo `R00-R06`

| Id    | Estado     | Nota                                                                                                                                                       |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R00` | completado | baseline real confirmado con `check:quality` y `check:docs-drift` en verde; ciclo reabierto en docs y debt register                                        |
| `R01` | completado | `clinical-documents` volvió a verde en `critical-coverage` con tests dirigidos sobre `ClinicalDocumentLabInsertDialog` y regeneración de artefactos        |
| `R02` | completado | `report-quality-metrics` quedó alineado con los mismos bypasses de `check:repo-hygiene`; las métricas residuales bajaron a `0`                             |
| `R03` | completado | `reports/technical-execution-baseline.{md,json}` volvió a existir y el drift documental por artefactos faltantes quedó corregido sin crear trackers nuevos |
| `R04` | completado | `reports/e2e/flow-performance-budget.*` quedó restaurado; `operational-health` ahora marca `flowPerformance: passing`                                      |
| `R05` | completado | hotspots acotados en `patient-row` orbital runtime e `indexedDbCore`; `BaseModal` queda diferido a mantenimiento si vuelve a ser cuello real de cambio     |
| `R06` | completado | convergencia final cerrada con `ci:pre-merge`, checks restantes de `ci:merge-gate`, reportes regenerados y deuda residual acotada a mantenimiento normal   |

## Historial del ciclo previo `Q00-Q07`

| Id    | Estado     | Nota                                                                                                                                                                                                                         |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Q00` | completado | plan iterativo abierto en `docs/ITERATIVE_QUALITY_EXECUTION_PLAN.md` y deuda registrada                                                                                                                                      |
| `Q01` | completado | `feature-dependency-matrix`, `test-failure-catalog` y artefactos `reports/*` quedaron alineados; checks de salida en verde                                                                                                   |
| `Q02` | completado | los shims de compatibilidad de `census` quedaron gobernados explícitamente y `sharedCensusBrowserRuntimeController` ya usa el adapter del feature                                                                            |
| `Q03` | completado | los casos de uso de `clinical-documents` ya consumen contratos internos en lugar de reingresar por `index/public`, `patient-flow` consolidó `Conflict` en el engine y `check:architecture` más `typecheck` quedaron en verde |
| `Q04` | completado | `handoff` migra `DailyRecord` al facade `@/application/shared/dailyRecordContracts`, `dailyRecordCoreContracts` queda declarado como facade permitida y `repo-hygiene` acepta el boundary interno de `clinical-documents`    |
| `Q05` | completado | `clinical-documents` usa `internal.ts` como colaboración explícita para `application/shared` y `laboratory` expone `index.ts` como root barrel                                                                               |
| `Q06` | completado | el PIN local ahora se comunica como bloqueo rápido de privacidad del navegador actual, la documentación aclara que no reemplaza auth/RBAC y las pruebas focalizadas del lock screen quedaron en verde                        |
| `Q07` | completado | `runtime-adapter-boundary`, `typecheck` y `check:quality` quedaron en verde; el ciclo se cierra sin excepciones activas de debt en guardrails                                                                                |

## Historial del ciclo previo `N01-N15`

| Id    | Estado                 | Nota                                                                                                                                             |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `N01` | completado             | `folder dependency debt` bajó a `0`; el antiguo `hooks -> features` quedó reclasificado como compatibilidad gobernada                            |
| `N02` | completado             | La causa real del debt era un bloque único de `25` shims en `src/hooks/controllers`                                                              |
| `N03` | no requerido por ahora | No se detectaron cruces impropios adicionales tras separar shims gobernados de deuda real                                                        |
| `N04` | completado             | `release confidence` volvió a `ok` al mapear `src/services/backup` en `export_and_backup`                                                        |
| `N05` | completado             | Baseline de `release confidence` y `quality metrics` regenerado y alineado                                                                       |
| `N06` | completado             | `minsalStatsCalculator.test.ts` quedó repartido entre `ranges-and-snapshots`, `aggregate-stats` y `stay-resolution`                              |
| `N07` | completado             | `firestore-rules.test.ts` quedó reducido a un entrypoint con harness común y grupos separados por dominio                                        |
| `N08` | completado             | `flake-risk files` bajó a `0` al eliminar el `Date.now()` no determinista de `auditViewThrottle.test.ts`                                         |
| `N09` | completado             | `check:domain-hotspot-boundary` volvió a verde al retirar el import directo residual desde `shared/census`                                       |
| `N10` | completado             | `reports/quality-metrics` ahora mide `raw console warn/error outside structured sink` y el valor quedó en `0`                                    |
| `N11` | completado             | `ApplicationOutcome` y sus helpers pasaron a `shared/contracts`; ya no quedan imports productivos a `application/shared/applicationOutcome*`     |
| `N12` | completado             | `docs/TECHNICAL_DEBT_REGISTER.md` quedó alineado con el estado actual; `census-type-drift` se cerró con `typecheck` verde y tests en API vigente |
| `N13` | completado             | `reports/quality-metrics` y baseline asociado se regeneraron tras cada ola estructural reciente y reflejan el estado actual                      |
| `N14` | completado             | Se sostuvieron dos ciclos reales de cadencia con nuevas olas `P2` sobre `CensusTable` y `TransferManagementView`, manteniendo gates verdes       |
| `N15` | completado             | Reevaluación de cierre ejecutada con métricas vigentes, gates verdes y deuda residual ya acotada a mantenimiento normal                          |

## Señal actual

- `check:quality`: `ok`
- `check:critical-coverage`: `ok`
- `check:flow-performance-budget`: `ok`
- `check:repo-hygiene`: `ok`
- `check:legacy-permissions-boundary`: `ok`
- `check:report-freshness`: `ok`
- `system-confidence`: `ok`
- `release-readiness`: `ok`
- `quality-metrics`: `featureBoundaryViolations=2`, `dailyRecordBoundaryViolations=0`, `rawConsoleWarnErrorOutsideStructuredSink=3`
- `maintenance-debt-scorecard`: `pendingHotspots=0`; watchlist explícita en `firestore.rules` y `src/hooks/useCensusEmailRecipientLists.ts`
- focos activos: `foundations`, `permissions` y `functions-security`; sin drift documental ni scorecards degradados

## Nota de consolidación 2026-04-19

- Se revalidó el cierre completo del ciclo con artefactos frescos y no solo con memoria histórica:
  - `ci:pre-merge`
  - `ci:preview-gate`
  - `check:flow-performance-budget`
  - `report:governance-snapshots`
  - `report:maintenance-debt-scorecard`
- `reports/system-confidence.{md,json}` quedó en `ok`.
- `reports/release-readiness-scorecard.{md,json}` quedó en `ok`.
- `operational-health` vuelve a reportar:
  - `flowPerformance: passing`
  - `frontendStartup: ok`
  - `previewGate: ok`
- `app-authenticated-shell` quedó bajo presupuesto y ya no degrada el scorecard de release.
- La deuda residual queda rebajada a watchlist de mantenimiento, no a gates activos:
  - `firestore.rules`
  - `src/hooks/useCensusEmailRecipientLists.ts`

## Nota de consolidación 2026-04-16

- `Bloque 1` quedó reforzado en runtime/bordes críticos:
  - funciones Netlify sensibles (`syslab`, `mmrad`, `whatsapp`) alineadas en `origin + bearer + role`
  - logging y warnings recuperables rebajados a diagnóstico interno cuando no bloquean uso real
  - runtime/auth/bootstrap más silencioso por defecto
- `Bloque 2` quedó avanzado sobre hotspots reales:
  - `useCensusEmailRecipientLists` movió la mecánica de sync diferido a un controller dedicado
  - `dailyRecord` compactó lectura remota/fallback y composición de resultados bloqueados en write
- `Bloque 3` quedó blindado en `clinical-documents` y `laboratory`:
  - superficies públicas/internas más explícitas
  - tests estáticos nuevos contra deep imports externos
- `Bloque 4` quedó reforzado con contratos críticos:
  - impresión/exportación clínica con `annexMode`
  - auth serverless con rechazo explícito de bearer inválido, issuer inválido y token expirado
  - sync de `dailyRecord` con contratos directos de `sourceOfTruth`, `consistencyState` y fallback local
- `Bloque 5` quedó razonablemente cerrado:
  - documentación canónica nueva en `auth`, `repositories` y `firebase-runtime`
  - borde PDF de `clinical-documents` separado en soporte binario, snapshot DOM y orquestación

## Nota de reportes 2026-04-19

- Se regeneraron `quality-metrics`, `critical-coverage`, `operational-health`, `system-confidence`, `release-readiness-scorecard`, `runtime-contracts`, `serverless-runtime-governance`, `serverless-sensitive-coverage`, `sustainable-change-policy` y `maintenance-debt-scorecard`.
- `check:report-freshness` vuelve a quedar alineado con `HEAD`.
- La señal ejecutiva ya no muestra degradación implícita:
  - `system-confidence`: `ok`
  - `release-readiness`: `ok`
- La watchlist restante queda explícita y chica:
  - `firestore.rules`
  - `src/hooks/useCensusEmailRecipientLists.ts`

## Nota de reportes 2026-04-16

- Se regeneraron `quality-metrics`, `maintenance-debt-scorecard`, `serverless-sensitive-coverage`, `serverless-runtime-governance`, `system-confidence`, `operational-health` y `release-readiness-scorecard`.
- `check:report-freshness` volvió a verde y ya no queda drift entre artefactos y `HEAD`.
- La convergencia estructural volvió a quedar limpia tras el lote:
  - `featureBoundaryViolations=0`
  - `rawConsoleWarnErrorOutsideStructuredSink=0`
- La señal ejecutiva dejó de verse “totalmente verde” y ahora refleja dos residuos reales:
  - `system-confidence` degradado por `critical_coverage`
  - `release-readiness` degradado por hotspot de bundle en `app-authenticated-shell`

## Pendientes reales de mayor retorno

1. `firestore.rules` sigue siendo el hotspot más grande del watchlist y merece nuevas iteraciones pequeñas sin tocar semántica.
2. `src/hooks/useCensusEmailRecipientLists.ts` ya bajó complejidad incidental, pero sigue en watchlist por tamaño y churn.
3. `quality-metrics` no bloquea, pero sigue reportando convergencia cualitativa que conviene vigilar aunque los guardrails formales estén verdes.
4. El siguiente retorno real está en mantenimiento incremental, no en abrir otro plan grande ni en agregar más tracker.

## Siguiente paso recomendado

1. Mantener una cadencia corta y quirúrgica sobre la watchlist, sin reabrir un ciclo grande.
2. Priorizar una iteración en `firestore.rules` o `src/hooks/useCensusEmailRecipientLists.ts`, no en ambos a la vez.
3. Mantener `reports/*` sincronizados al cierre de cada lote y volver a correr `check:report-freshness`.
