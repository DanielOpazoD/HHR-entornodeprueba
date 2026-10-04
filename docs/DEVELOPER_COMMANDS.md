# Developer Commands

Este documento separa los comandos oficiales del repo de los scripts internos o especializados. La regla es simple:

- si trabajas día a día en la app, usa primero los comandos oficiales;
- si necesitas diagnóstico, auditoría o una validación puntual, entra a los scripts especializados;
- consulta `package.json` para el inventario vigente; usa este mapa para elegir un gate.

## Comandos oficiales

Estos son los entrypoints recomendados para trabajo normal.

| Comando                   | Cuándo usarlo                                          |
| ------------------------- | ------------------------------------------------------ |
| `npm run dev`             | desarrollo local de la app                             |
| `npm run typecheck`       | validar tipos antes de subir cambios                   |
| `npm run lint`            | validar lint global                                    |
| `npm run test:ci:unit`    | suite unitaria/integración base sin emuladores         |
| `npm run check:quality`   | guardrails estructurales y de gobernanza               |
| `npm run ci:inner-loop`   | verificación local rápida antes de seguir iterando     |
| `npm run ci:pre-merge`    | gate compacto antes de merge                           |
| `npm run ci:preview-gate` | gate del bundle real en preview local                  |
| `npm run ci:merge-gate`   | gate blocking ampliado para cambios sensibles          |
| `npm run ci:release-gate` | validación final con Firestore/emuladores/E2E críticos |

## Comandos oficiales por escenario

### Desarrollo diario

1. `npm run dev` y pruebas focalizadas mientras editas.
2. `npm run ci:inner-loop` al cerrar la iteración: ya incluye tipos, lint, calidad y pruebas críticas.

Ejecuta `typecheck` o `lint` por separado sólo para diagnosticar esa etapa; no repitas
los mismos controles sobre código sin cambios antes del gate que ya los contiene.

### Antes de merge

Si el equipo tiene poca memoria disponible, `npm run test:ci:unit -- --maxWorkers=4`
limita la concurrencia usando la opción existente de Vitest. Conserva la selección
de pruebas y los timeouts; no reemplaza los demás controles del gate. En la
[medición local del 29-09-2026](./LOCAL_TEST_RESOURCE_BASELINE_2026-09-29.md)
redujo la memoria del grupo medido, pero tardó más. Usar pruebas focalizadas durante
edición y evitar ejecutar gates duplicados simultáneamente. CI y el modo habitual
conservan su configuración; no extrapolar el resultado a toda la suite.

Elige el gate en la [selección local de SAFE_CHANGE_CHECKLIST.md](./SAFE_CHANGE_CHECKLIST.md#selección-local-del-gate).
Esa referencia distingue documentación, cambios habituales, runtime y releases,
y conserva los requisitos adicionales de la política. Las etapas efectivas se
definen en `package.json`; su explicación está en
[CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md).

No encadenes gates completos. Para diagnosticar sólo el bundle productivo ya
construido, usa `npm run ci:preview-gate`. Tras cambiar código, repite los controles
afectados; el CI del SHA final debe aprobarse antes del merge.

### Antes de release o validación operativa fuerte

1. `npm run ci:release-gate`

El gate invoca internamente `release:evidence:refresh`, la única orden local que
reconstruye el paquete completo en orden determinista y deja el manifiesto embebido
en `dist/`. Puede ejecutarse por separado para diagnosticar sólo esa etapa. Ver
[RUNBOOK_RELEASE_EVIDENCE_CONTRACT.md](./RUNBOOK_RELEASE_EVIDENCE_CONTRACT.md).

### Antes de auditoría técnica o revisión ejecutiva

Seguir la sección [Evidencia vigente de la cadencia](./FOUNDATION_MAINTENANCE_CADENCE.md#evidencia-vigente):
identifica los insumos necesarios y el comando para regenerar el paquete canónico.
Preferir los artefactos del CI del SHA evaluado antes de repetir generación local.

`check:report-freshness` es advisory para uso diario. Para aprobar evidencia de
release, aplicar los [contratos bloqueantes del runbook](./RUNBOOK_RELEASE_EVIDENCE_CONTRACT.md#contratos-bloqueantes),
que incluyen freshness estricta. Compartir SHA con `HEAD` no basta: también se
comprueban las huellas de las entradas. La política y su recuperación se documentan
allí, sin mantener otra copia de sus condiciones en este catálogo.

Después de un merge a `main`, usar `npm run postmerge:evidence` para generar `reports/postmerge-evidence.{json,md}`. En GitHub Actions, el job `postmerge-evidence` lo ejecuta solo en `push` a `main` y sube el artifact `postmerge-release-evidence`.

### Si tocas reglas, runbooks o documentación operativa

1. Si cambias `firestore.rules` o `storage.rules`: `npm run build:rules-assets`
2. `npm run check:security`
3. `npm run check:docs-drift`
4. `npm run check:operational-runbooks`
5. Si necesitas refrescar snapshots report-only: `npm run report:governance-snapshots`

## Scripts especializados

Estos scripts siguen soportados, pero no forman parte de la superficie pública mínima.

### Testing especializado

- `npm run test:rules`
- `npm run test:rules:ci`
- `npm run test:emulator:sync`
- `npm run test:emulator:ui`
- `npm run test:firestore:cma:ci`
- `npm run test:e2e`
- `npm run test:e2e:critical`
- `npm run test:e2e:flow-performance`
- `npm run test:release-confidence`
- `npm run test:release-confidence:full`
- `npm run test:coverage`
- `npm run test:coverage:critical`

### Checks de gobernanza y arquitectura

- `npm run check:repo-hygiene`
- `npm run check:architecture`
- `npm run check:guardrail-governance`
- `npm run check:runtime-contracts`
- `npm run check:critical-coverage`
- `npm run check:flow-performance-budget`
- `npm run check:unit-shard-balance`
- `npm run check:ci-runtime-telemetry`
- `npm run check:test-runtime-governance`
- `npm run check:security`
- `npm run check:docs-drift`
- `npm run check:operational-runbooks`

### Reglas y operación

- `npm run build:rules-assets`
- `npm run check:report-freshness`
- `npm run check:release-evidence`
- `npm run check:release-evidence-contract`
- `npm run check:release-evidence-contract:strict`
- `npm run check:release-evidence-contract:built`
- `npm run report:governance-snapshots`
- `npm run release:evidence:refresh`

### Reportes y auditoría

- `npm run report:quality-metrics`
- `npm run report:operational-health`
- `npm run report:system-confidence`
- `npm run report:architectural-hotspots`
- `npm run report:unit-shard-runtime-profile`
- `npm run profile:unit-shard-runtime`
- `npm run report:ci-runtime-observed-profile`
- `npm run report:test-runtime-governance`
- `npm run report:release-readiness-scorecard`
- `npm run report:runtime-contracts`

## Convención operativa

- `dev`, `typecheck`, `lint`, `test:ci:unit`, `check:quality` y `ci:*` son la superficie pública recomendada.
- `check:*`, `report:*` y `test:*` más específicos deben tratarse como herramientas de diagnóstico o validación focalizada.
- Si aparece un script nuevo que debería usar casi todo el equipo, debe entrar a esta lista oficial o no vale la pena publicitarlo.
- `npm run test:e2e` corre Chromium por defecto para mantener el ciclo local rápido. Para una revisión cross-browser puntual usa `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e`; no lo promuevas a gate diario sin una señal real de compatibilidad.

## Higiene mínima de commits

- No mezclar en un mismo commit cambios de runtime de la app con assets estáticos o snapshots de `reports/`, salvo que formen parte del mismo fix y se validen juntos.
- Si una auditoría depende de `reports/*`, primero confirma `git status --short` y `npm run check:report-freshness`; no asumas que un snapshot viejo representa el HEAD actual.
- Si el cambio toca lógica clínica y además documentación operativa, mantenerlo en el mismo commit solo cuando la documentación explica o gobierna exactamente ese cambio.
