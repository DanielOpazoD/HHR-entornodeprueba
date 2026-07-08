# Developer Commands

Este documento separa los comandos oficiales del repo de los scripts internos o especializados. La regla es simple:

- si trabajas día a día en la app, usa primero los comandos oficiales;
- si necesitas diagnóstico, auditoría o una validación puntual, entra a los scripts especializados;
- no memorices los `140` scripts del `package.json`: usa este mapa.

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

1. `npm run dev`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run ci:inner-loop`

### Antes de merge

1. `npm run ci:pre-merge`
2. Si el cambio toca runtime clínico, storage, auth, bundle o boundaries críticos: `npm run ci:merge-gate`
3. Si quieres aislar solo el riesgo del bundle productivo ya construido: `npm run ci:preview-gate`

### Antes de release o validación operativa fuerte

1. `npm run ci:release-gate`

### Antes de auditoría técnica o revisión ejecutiva

1. `git status --short`
2. `npm run check:report-freshness`
3. Si necesitas snapshots actualizados: `npm run report:governance-snapshots`
4. Recién después usar `reports/*` como evidencia del checkout actual

`check:report-freshness` es advisory para uso diario: muestra drift de reportes sin bloquear ramas operativas. Para release real, usar `npm run check:release-evidence`: ejecuta `check:report-freshness:strict` y además bloquea reportes generados desde un checkout con cambios locales significativos.
La evidencia de release también exige el artefacto dedicado del smoke visual clínico en `reports/e2e/clinical-visual-release-report.json`; `npm run report:release-evidence` lo genera antes de refrescar los reportes ejecutivos.
`check:report-freshness:strict` considera frescos los reportes generados para `HEAD`. Los reportes generados para un padre directo de un merge commit solo pasan si incluyen `generatedFor.dependencyFingerprint` y el fingerprint coincide con las dependencias transitivas actuales; esto distingue un drift inocuo de merge commit de un cambio real en la evidencia. Ancestros antiguos, padres de commits lineales normales y fingerprints divergentes bloquean el gate con un comando de recuperación concreto.

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
- `npm run report:governance-snapshots`

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
