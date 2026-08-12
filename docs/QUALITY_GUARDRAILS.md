# Quality Guardrails

## Objetivo

Evitar que la deuda estructural vuelva a crecer después de las fases de estabilización de `clinical-documents`, `census`, `transfers` y `backup/export`.

## Capas estándar

| Capa           | Responsabilidad                                  |
| -------------- | ------------------------------------------------ |
| `components/`  | Render y composición visual                      |
| `hooks/`       | Coordinación React y wiring de dependencias      |
| `controllers/` | Lógica pura, mapeos, policies y validaciones     |
| `application/` | Casos de uso y orquestación tipada               |
| `domain/`      | Invariantes de negocio y contratos del módulo    |
| `services/`    | IO, persistencia, infraestructura, integraciones |

## Reglas de crecimiento

1. Un archivo que supere el límite global de tamaño debe entrar documentado en `scripts/module-size-allowlist.json`.
2. Todo hotspot permitido debe incluir motivo, owner y estado en el backlog versionado.
3. Un hotspot permitido no puede crecer por sobre su límite sin actualizar explícitamente la allowlist.
4. Los hooks grandes usan `scripts/hook-hotspots-limits.json` con la misma disciplina de backlog.
5. La regla por defecto es extraer controllers/helpers puros antes de mover JSX o cambiar contratos públicos.
6. `npm run lint` es tolerancia cero; no se aceptan warnings nuevos en `src/`.
7. Los providers de infraestructura obligatorios deben fallar rápido si falta wiring.
8. Los servicios críticos que dependan de Firebase Functions/Auth/Storage deben preferir `create...Service(...)` o runtime inyectable y conservar singleton por defecto solo por compatibilidad.
9. Los refactors de backup/exportación deben dejar tests de runtime o fallback; no basta con tests puramente superficiales del consumer.
10. Si `backup/export` pasa a ser subsistema crítico de release, debe quedar también reflejado en `critical-coverage` y en `technical-ownership-map`, no solo en budgets de flujo.
11. Los chunks de arranque del shell crítico deben vivir en `scripts/config/bundle-budget.json` y no quedar como heurísticas hardcodeadas en el checker.

## Cómo agregar un guardrail nuevo

1. Preferir `scripts/check-*.mjs` o `scripts/report-*.mjs` antes de introducir tooling externo.
2. Si el guardrail es informativo, agregarlo primero como report-only.
3. Si luego se vuelve blocking, dejar baseline/allowlist documentada.
4. Enlazar el guardrail nuevo desde `package.json`, CI y esta guía.
5. Actualizar `scripts/config/guardrail-governance.json` para decidir si nace como blocking o report-only.

## Entry points de calidad

- La fuente de verdad de tiers blocking, release confidence y report-only guards vive en `scripts/config/guardrail-governance.json`.
- Se valida con `npm run check:guardrail-governance` y se reporta con `npm run report:guardrail-governance`.
- La composición exacta de `check:quality` también sale de ese mismo archivo; `check-quality-aggregate.mjs` ya no mantiene una lista paralela.
- CI regenera los artefactos obligatorios antes de correr `check:quality` usando `npm run report:governance-snapshots`.
- `check:quality` no debe bloquear por scorecards ejecutivos derivados si las fuentes primarias del riesgo ya están protegidas; `release-readiness-scorecard` queda como artefacto report-only.
- `release-confidence-matrix` también queda como guardrail report-only: sigue siendo obligatorio para trazabilidad, pero no duplica bloqueo si el pack de release, la cobertura crítica y los budgets ya siguen verdes.
- `npm run ci:inner-loop`
- `npm run ci:pre-merge`
- `npm run ci:merge-gate`
- `npm run ci:preview-gate`
- `npm run ci:release-gate`
- `npm run ci:quality-core`
- `npm run check:quality`
- `npm run check:release-evidence`
- `npm run check:release-evidence-contract:strict`
- `npm run check:release-evidence-contract:built`
- `npm run check:test-failure-catalog`
- `npm run check:hotspot-growth`
- `npm run report:quality-metrics`
- `npm run report:maintenance-debt-scorecard`
- `npm run report:operational-health`
- `npm run report:system-confidence`
- `npm run report:release-readiness-scorecard`
- `npm run report:governance-snapshots`
- `npm run report:guardrail-governance`
- `npm run report:runtime-contracts`
- `npm run report:critical-coverage`
- `npm run check:flow-performance-budget`
- `npm run report:flow-performance-budget`

## Operación diaria

- El mapa corto de ejecución y fallback vive en [docs/CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md).
- La superficie pública mínima de comandos vive en [docs/DEVELOPER_COMMANDS.md](./DEVELOPER_COMMANDS.md).
- La cadencia mensual de convergencia vive en [docs/FOUNDATION_MAINTENANCE_CADENCE.md](./FOUNDATION_MAINTENANCE_CADENCE.md).
- El estado persistente del roadmap estructural vive en [docs/FOUNDATION_TRACKER.md](./FOUNDATION_TRACKER.md).
- `ci:inner-loop` es la ruta local rápida.
- `ci:pre-merge` es la verificación compacta obligatoria antes de merge.
- `ci:preview-gate` es el sub-gate productivo del merge gate: budgets, chunk graph y smoke del bundle real en preview local.
- `ci:merge-gate` es la ruta blocking ampliada previa a merge y debe delegar el chequeo del bundle productivo a `ci:preview-gate`.
- `ci:release-gate` agrega evidencia limpia de release, emuladores, reglas y E2E críticos.
- Los artifacts del smoke de preview deben quedar en `reports/e2e/preview-bootstrap/` y/o `playwright-report/` para diagnóstico cuando falle CI.
- `test:release-confidence` es el pack blocking compacto; no debe crecer sin justificar el riesgo nuevo en `guardrail-governance.json`.
- Los budgets por flujo se leen desde `reports/e2e/flow-performance-budget.json` y su resumen en `reports/e2e/flow-performance-budget-summary.json` / `.md`.
- El estado operativo por flujo distingue `ok`, `near-limit`, `target-miss` y `blocking`.
- El ownership técnico crítico vive en `scripts/config/technical-ownership-map.json` y se valida con `npm run check:technical-ownership-map`.
- `technical-ownership-map` se mantiene como gobernanza report-only dentro del aggregate: sigue siendo obligatorio para trazabilidad y release readiness, pero ya no bloquea `check:quality` porque los riesgos primarios ya quedan cubiertos por gates, runbooks y release confidence.
- La política de cambio sostenible vive en `scripts/config/sustainable-change-policy.json` y se valida con `npm run check:sustainable-change-policy`.
- `sustainable-change-policy` también queda como gobernanza report-only dentro del aggregate: sigue siendo obligatoria para upgrades, excepciones y DoD, pero no bloquea `check:quality` si los gates primarios y las fuentes técnicas siguen verdes.
- La política para decidir si una mejora técnica vale la pena antes de ejecutarla vive en [docs/ENGINEERING_CHANGE_DECISION_POLICY.md](./ENGINEERING_CHANGE_DECISION_POLICY.md).
- La definición de terminado vive en [docs/ENGINEERING_DEFINITION_OF_DONE.md](./ENGINEERING_DEFINITION_OF_DONE.md).
- La deuda priorizada vive en [docs/TECHNICAL_DEBT_REGISTER.md](./TECHNICAL_DEBT_REGISTER.md).
- El registro interno recurrente de iteraciones de mantenimiento vive en [docs/MAINTENANCE_ITERATION_LOG.md](./MAINTENANCE_ITERATION_LOG.md).
- `ci:release-gate` valida `check:release-evidence`: primero exige `check:report-freshness:strict` y luego bloquea si los reportes ejecutivos fueron generados desde un checkout con cambios locales significativos, si `quality-metrics` conserva tests con riesgo flaky (`flakeRiskFiles > 0`) o si falta la evidencia dedicada del smoke visual clínico (`reports/e2e/clinical-visual-release-report.json`). El comando diario `check:report-freshness` es advisory para evitar que cada merge requiera una rama de reportes nueva.
- El inventario canónico de evidencia de release vive en `scripts/releaseEvidenceContract.mjs`. `release:evidence:refresh` lo regenera en orden determinista; CI impone freshness estricta, transporta el manifiesto al build y verifica post-merge que SHA, fecha y vigencia correspondan al código integrado.
- Los fallos conocidos no resueltos deben vivir en `scripts/config/test-failure-catalog.json` con owner, clasificación y SLA.
- Los riesgos flaky aceptados temporalmente deben vivir en `scripts/config/flaky-quarantine.json` y reflejarse también en el catálogo de fallos.

## Señales de convergencia

Además de tamaño, lint y coverage, la base debe vigilar:

- imports profundos fuera de la API pública de `census`, `handoff`, `transfers` y `clinical-documents`;
- imports nuevos hacia shims de compatibilidad;
- drift entre owners documentados y owners reales en controllers compartidos;
- megatests de más de `500` líneas;
- fallos de `typecheck` causados por contratos o shapes ya retirados.

La referencia reportable de estas señales vive en `reports/quality-metrics.md` y el backlog operativo en `docs/FOUNDATION_TRACKER.md`.

## Cuándo abrir una excepción

Solo cuando se cumplan las dos condiciones:

1. partir el archivo en esa iteración rompe contratos o consume demasiado riesgo clínico/operativo;
2. la excepción queda anotada en backlog con límite, motivo y owner claros.

Si no se cumplen ambas, el archivo debe reducirse en la misma change.
