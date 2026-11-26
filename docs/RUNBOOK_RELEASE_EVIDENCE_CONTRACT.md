# Runbook: evidencia viva y contrato de release

## Objetivo

Una decisión de merge o release sólo puede citar evidencias generadas para el mismo
commit que se construye. Los tres informes primarios con frescura estricta viven en
`scripts/reportFreshnessSupport.mjs` y `scripts/evidenceDependencyGraph.mjs`:

- `reports/critical-coverage.json` (`critical-coverage-report`)
- `reports/sync-convergence.json` (`clinical-sync-release-gate`)
- `reports/operational-health.json` (`final-confidence-and-readiness`)

`reports/` sigue siendo un directorio generado. Los informes no se consideran
evidencia por existir en un checkout: deben regenerarse y pasar freshness estricta.

## Contratos bloqueantes

- `npm run check:report-freshness:strict`: todos los informes primarios corresponden
  al checkout actual y a sus dependencias reales (`generatedFor.dependencyFingerprint`).
- `npm run check:ci-artifact-contracts`: comprueba productor, orden, ruta y consumidor
  de cobertura crítica, preview y build.
- `npm run check:preview-bootstrap-evidence`: verifica la procedencia del smoke de preview.
- `npm run check:flow-performance-budget`: bloquea regresiones sobre los límites E2E.

Que el `gitSha` del reporte coincida con `HEAD` no basta: para todos los commits
aceptados por la política de ancestry, el control exige
`generatedFor.dependencyFingerprint` y lo compara con las entradas actuales.
Una entrada modificada o eliminada invalida el reporte aunque conserve su fecha
de modificación.

## Flujo de CI

1. `critical-coverage-report` produce cobertura crítica una sola vez y bloquea `quality-static`.
2. `quality-static-groups` corre los cinco grupos (`boundaries`, `governance`, `security`, `size`, `tests`) en paralelo directo desde `ci-scope`.
3. `build` arranca en paralelo desde `ci-scope` y produce el `dist` único consumido
   por `preview-smoke-lanes`, `lighthouse-ci`, `final-confidence-and-readiness` y `postmerge-evidence`.
4. `final-confidence-and-readiness` fusiona preview y E2E críticos, arma `test-execution-manifest`,
   regenera `operational-health` y exige frescura estricta sobre ese informe.
5. En `push` a `main`, `postmerge-evidence` descarga `dist`, `preview-bootstrap-artifacts`,
   `critical-coverage` y `flow-performance-evidence` del mismo run (o del PR reutilizado cuando el
   árbol es idéntico) y valida la evidencia post-merge.

## Recuperación

1. Confirmar `git status --short` y `git rev-parse --short HEAD`.
2. Regenerar el productor que falló (`check:critical-coverage`, `report:sync-convergence` o `report:operational-health`); no editar JSON/Markdown generados a mano.
3. Repetir `npm run check:report-freshness:strict`.
4. Si falla sólo post-merge, revisar que cobertura, preview y `dist` provengan del
   mismo run de GitHub Actions.
