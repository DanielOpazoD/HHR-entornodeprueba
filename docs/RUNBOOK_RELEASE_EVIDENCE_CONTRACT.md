# Runbook: evidencia viva y contrato de release

## Objetivo

Una decisión de merge o release sólo puede citar informes generados para el mismo
commit que se construye. El contrato central vive en
`scripts/releaseEvidenceContract.mjs`; allí se declaran el productor, responsable,
consumidores, rol y política de actualización de cada informe.

El manifiesto resultante declara:

- SHA y estado del worktree usados al generar la evidencia;
- fecha de generación;
- cantidad de informes de decisión vigentes;
- productor, owner, consumidores y política de cada informe.

`reports/` sigue siendo un directorio generado. Los informes no se consideran
evidencia por existir en un checkout: deben regenerarse y pasar freshness estricta.

## Comando canónico

Para reconstruir el paquete completo, incluidas evidencias visuales y el manifiesto
de vigencia:

```bash
npm run release:evidence:refresh
```

El comando ejecuta un orden topológico determinista: compila `dist/`, prepara las
evidencias E2E, regenera productores e insumos, valida freshness y escribe el manifiesto.

Para regenerar sólo los reportes durante CI o diagnóstico, cuando las evidencias E2E
ya fueron producidas y descargadas por el workflow:

```bash
npm run report:release-evidence
```

Esta variante no sustituye la reconstrucción completa para una aprobación local de
release.

## Contratos bloqueantes

- `npm run check:report-freshness:strict`: todos los informes de decisión corresponden
  al checkout actual y a sus dependencias.
- `npm run check:release-evidence-contract:strict`: el inventario y el manifiesto son
  completos, actuales y coherentes con `HEAD`.
- `npm run check:ci-artifact-contracts`: comprueba productor, orden, ruta y consumidor
  de cobertura crítica, preview y build.

Que el `gitSha` del reporte coincida con `HEAD` no basta: para todos los commits
aceptados por la política de ancestry, el control exige
`generatedFor.dependencyFingerprint` y lo compara con las entradas actuales.
Una entrada modificada o eliminada invalida el reporte aunque conserve su fecha
de modificación. Los reportes sin huella utilizable deben regenerarse; no añadir
la huella manualmente ni usar el modo advisory como aprobación de release.

## Flujo de CI

1. `critical-coverage-report` produce cobertura crítica una sola vez.
2. `quality-static-governance-snapshots` descarga ese insumo, regenera el paquete e
   impone freshness estricta.
3. `build` arranca en paralelo desde `ci-scope` y produce el `dist` único consumido
   por `preview-smoke-lanes`, `lighthouse-ci` y `postmerge-evidence`.
4. Cada PR valida el contrato y la frescura de los reportes usados para decidir.
5. En `push` a `main`, `postmerge-evidence` descarga los artefactos del mismo run y
   regenera por separado la evidencia post-merge.
   Si `main` reutiliza la corrida de la PR que probó su mismo árbol, los artefactos
   vienen de esa corrida (ver «`main` no repite la CI de la PR» en
   [CI y recuperación](CI_GATES_AND_FAILURE_RUNBOOKS.md)).

## Recuperación

1. Confirmar `git status --short` y `git rev-parse --short HEAD`.
2. Ejecutar `npm run release:evidence:refresh`.
3. Corregir el primer productor que falle; no editar JSON/Markdown generados a mano.
4. Repetir `npm run check:release-evidence-contract:strict`.
5. Si falla sólo post-merge, revisar que cobertura, preview y `dist` provengan del
   mismo run de GitHub Actions.
