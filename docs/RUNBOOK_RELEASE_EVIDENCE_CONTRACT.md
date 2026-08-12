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

Para reconstruir el paquete completo, incluidas evidencias visuales y el bundle que
expone su manifiesto:

```bash
npm run release:evidence:refresh
```

El comando ejecuta un orden topológico determinista: prepara las evidencias E2E,
regenera productores e insumos, valida freshness, escribe el manifiesto y vuelve a
construir `dist/` para incorporar exactamente ese contrato.

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
- `npm run check:release-evidence-contract:built`: vuelve a validar el manifiesto
  estricto descargado desde el productor y comprueba que
  `dist/release-evidence.json` coincide exactamente con su resumen runtime.
- `npm run check:ci-artifact-contracts`: comprueba productor, orden, ruta y consumidor
  del manifiesto, cobertura crítica, preview y build.

## Flujo de CI

1. `critical-coverage-report` produce cobertura crítica una sola vez.
2. `quality-static-governance-snapshots` descarga ese insumo, regenera el paquete,
   impone freshness estricta y publica `release-evidence-runtime`.
3. `build` descarga el manifiesto antes de compilar; Vite lo incorpora como
   `/release-evidence.json`.
4. Cada PR valida el contrato y la frescura de los reportes usados para decidir.
5. En `push` a `main`, `postmerge-evidence` descarga los artefactos del mismo run,
   verifica el manifiesto que entró al build y regenera por separado la evidencia
   post-merge. No vuelve a publicar esa regeneración como contrato del bundle.

## Lectura operativa

El panel técnico muestra `Vigente`, `Desactualizada` o `No generada`, junto con SHA,
fecha en zona `Pacific/Easter` y proporción de informes de decisión vigentes.

- **Vigente:** el build y el paquete de evidencia representan el mismo código.
- **Desactualizada:** no aprobar release; ejecutar el comando canónico.
- **No generada:** el build no porta evidencia verificable; revisar la cadena CI.

## Recuperación

1. Confirmar `git status --short` y `git rev-parse --short HEAD`.
2. Ejecutar `npm run release:evidence:refresh`.
3. Corregir el primer productor que falle; no editar JSON/Markdown generados a mano.
4. Repetir `npm run check:release-evidence-contract:built`.
5. Si falla sólo post-merge, revisar que cobertura, preview y `dist` provengan del
   mismo run de GitHub Actions.
