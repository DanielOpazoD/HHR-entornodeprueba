# Guía de Testing - Hospital Hanga Roa

Este documento resume cómo se valida el repo hoy, con gates por capas y cobertura crítica instrumentada.

## 1. Capas de prueba

### Unitarias y de integración (`src/tests/`)

Cobren hooks, controllers, casos de uso, repositorios, contratos runtime y flujos integrados de negocio.

### Reglas y emulador

Validan seguridad Firestore, sincronización y comportamiento de adapters con emulador local.

### E2E (`e2e/`)

Playwright cubre auth, startup, módulos críticos y regresiones de UX prioritaria.

## 2. Comandos vigentes

Superficie pública mínima recomendada para trabajo diario: [docs/DEVELOPER_COMMANDS.md](../DEVELOPER_COMMANDS.md)

| Comando                                      | Descripción                                                                                                               |
| :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:ci:unit`                       | Suite unitaria/integración de CI sin reglas ni emulador                                                                   |
| `npm run test:coverage:critical`             | Cobertura crítica instrumentada por zona                                                                                  |
| `npm run test:smoke:critical-runtime`        | Smoke pack curado para `cold boot`, `login`, `offline -> online`, `sync conflict`, `export` y `clinical-documents`        |
| `npm run test:release-confidence`            | Pack compacto blocking de release confidence: smoke runtime, rules, emulador, coverage, performance y E2E críticos        |
| `npm run test:release-confidence:full`       | Pack extendido de release confidence: agrega `unit_critical` para corridas de validación más profundas                    |
| `npm run test:e2e:critical`                  | E2E críticos sobre emulador                                                                                               |
| `npm run test:e2e:flow-performance`          | Budgets de performance por flujo (`login`, `auth`, `censo visible`, `censo record-ready`, `clinical-documents`, `backup`) |
| `npm run test:rules`                         | Reglas Firestore                                                                                                          |
| `npm run test:emulator:sync`                 | Suite de emulador sync                                                                                                    |
| `npm run test:emulator:ui`                   | Suite de emulador UI                                                                                                      |
| `npm run check:critical-smoke-pack`          | Verifica que el smoke pack crítico siga cubriendo todos los escenarios obligatorios                                       |
| `npm run check:release-confidence-pack`      | Verifica perfiles, tiers, solapes permitidos y scripts válidos del release confidence pack                                |
| `npm run check:release-confidence-matrix`    | Verifica que cada área crítica tenga trazabilidad explícita hacia coverage, smoke, budgets y pasos blocking de release    |
| `npm run check:unit-shard-balance`           | Verifica que los 4 unit-risk shards cubran la suite completa sin duplicados y con spread dentro de tolerancia             |
| `npm run profile:unit-shard-runtime`         | Ejecuta la suite unitaria con reporter JSON y regenera el perfil real por archivo/shard                                   |
| `npm run report:unit-shard-runtime-profile`  | Regenera `reports/unit-shard-runtime-profile.*` desde el último perfil real o estimaciones deterministas                  |
| `npm run report:ci-runtime-observed-profile` | Regenera `reports/ci-runtime-observed-profile.*` con runtime observado de GitHub Actions o fixture local opcional         |
| `npm run check:ci-runtime-telemetry`         | Valida el contrato estructural del runtime observado; los desbalances aislados son advisory-first                         |
| `npm run check:test-runtime-governance`      | Verifica el contrato PR vs nightly, shards, budgets y watchlist de fixtures duplicadas                                    |
| `npm run report:test-runtime-governance`     | Genera `reports/test-runtime-governance.*` con señales de runtime lento y duplicación de fixtures                         |
| `npm run ci:inner-loop`                      | Ruta rápida para desarrollo diario                                                                                        |
| `npm run ci:pre-merge`                       | Verificación compacta obligatoria antes de merge                                                                          |
| `npm run ci:preview-gate`                    | Gate productivo del bundle real: budgets, grafo de chunks y smoke preview local                                           |
| `npm run ci:merge-gate`                      | Ruta blocking ampliada previa a merge                                                                                     |
| `npm run ci:release-gate`                    | Ruta completa con Firestore + E2E                                                                                         |

## 3. Cobertura crítica

La cobertura crítica ya no se gobierna por conteo de tests o ratios test/source.

Ahora se valida por zonas instrumentadas:

- `census/controllers`
- `clinical-documents`
- `services/transfers`
- `services/storage/firestore`
- `services/auth/bootstrap`
- `features/reminders/admin`
- `services/storage/sync-critical`
- `services/storage/indexeddb-recovery`

Artefactos:

- `reports/critical-coverage.md`
- `reports/critical-coverage.json`

## 4. Performance por flujo

Artefacto actual:

- `reports/e2e/flow-performance-budget.json`
- `reports/e2e/flow-performance-budget-summary.json`
- `reports/e2e/flow-performance-budget.md`

Comandos:

- `npm run test:e2e:flow-performance`
- `npm run check:flow-performance-budget`

El budget diferencia entre:

- `enforcedMaxMs`: límite blocking actual
- `targetMs`: objetivo deseado, útil para exponer gaps sin romper CI de inmediato
- `status` por flujo en el reporte generado: `ok`, `near-limit`, `target-miss`, `blocking`

## 5. Criterio práctico

1. Si la change es local o todavía exploratoria, correr `npm run ci:inner-loop`.
2. Antes de merge, correr al menos `npm run ci:pre-merge`.
3. Si toca código clínico, runtime, bundle o cobertura, cerrar con `npm run ci:merge-gate`.
4. Si toca Firestore, reglas, emulador o UX crítica, cerrar con `npm run ci:release-gate`.

`ci:merge-gate` ya incorpora `ci:preview-gate`, que hoy es la fuente de verdad para validar que el bundle productivo realmente monta en preview local sin blank page silenciosa.

Los demás scripts de este documento deben tratarse como validaciones especializadas, no como superficie pública mínima.

## 5.1 Gobernanza de runtime de tests

El contrato PR vs nightly vive en `scripts/config/test-runtime-governance.json`.

En PR deben seguir bloqueando:

- `unit-risk-shards`
- `clinical-sync-release-gate`
- `rules-emulator`
- `e2e-critical`

Las suites más caras quedan en `.github/workflows/nightly-test-runtime.yml` con `workflow_dispatch`
y `schedule`, no en `pull_request`:

- `test:sync-load`
- `test:release-confidence:full`
- `test:e2e:clinical-stability:ci`

El reporte `reports/test-runtime-governance.md` lista los checks lentos disponibles desde perfiles
locales/CI y expone señales de duplicación de fixtures. Su objetivo es bajar runtime con datos,
sin sacar cobertura clínica crítica del PR.

El balance estimado/local de los 4 unit-risk shards vive en `scripts/config/unit-shard-balance.json` y se
valida con `npm run check:unit-shard-balance`. El script `test:ci:unit:shard` no usa el sharding
nativo de Vitest; llama a `scripts/run-unit-shard.mjs`, que selecciona archivos mediante una
asignación determinista por duración medida/estimada. Para refrescar la medición:

1. Ejecutar `npm run profile:unit-shard-runtime`.
2. Revisar `reports/unit-shard-runtime-profile.md`.
3. Si el spread supera la tolerancia, ajustar `perFileOverheadMs`, `durationHints`, `affinityGroups` o
   `lockedAssignments` sin mover cobertura crítica fuera del PR.
4. Cerrar con `npm run check:unit-shard-balance` y `npm run check:test-runtime-governance`.

El perfil debe responder qué shard es más lento, qué archivos explican el costo y si el balance
sigue bajo la tolerancia. La suite clínica crítica sigue cubierta por `unit-risk-shards`,
`clinical-sync-release-gate`, `rules-emulator` y `e2e-critical`.

El runtime observado de GitHub Actions complementa ese balance local con `reports/ci-runtime-observed-profile.*`.
En CI lo genera el job `ci-runtime-telemetry`, que corre después de los gates PR-critical, llama a
`npm run collect:ci-runtime-observed-input`, consulta los jobs del `GITHUB_RUN_ID` actual y después ejecuta
`npm run report:ci-runtime-observed-profile` + `npm run check:ci-runtime-telemetry`.

Esta señal es advisory-first: `npm run check:ci-runtime-telemetry` no bloquea por ausencia de datos reales ni
por un desbalance aislado de una corrida, pero sí falla si el contrato queda roto, por ejemplo JSON inválido,
shards declarados incompletos, timestamps imposibles, duplicados o nombres imposibles como `unit-risk-shard-5`.
Para simular una corrida sin API:

1. Guardar un fixture con jobs en `reports/ci-runtime-observed-input.json` o pasar `--input path/al/fixture.json`.
2. Ejecutar `npm run report:ci-runtime-observed-profile`.
3. Revisar `reports/ci-runtime-observed-profile.md` y luego `npm run check:ci-runtime-telemetry`.
4. Si el desbalance observado se repite en más de una corrida, ajustar `perFileOverheadMs`,
   `durationHints`, `affinityGroups` o `lockedAssignments`. No mover tests clínicos críticos a nightly para
   mejorar tiempos aparentes.

El markdown observado debe responder rápido: fuente/run, total observado, shard lento/rápido, tabla de shards,
diferencia contra estimación y hallazgos advisory. Si aparece `no_observed_ci_data` en CI, revisar primero que
`ci-runtime-telemetry` tenga `actions: read`, `GITHUB_TOKEN` y `GITHUB_RUN_ID`, y que el collector se haya ejecutado
antes del reporte.

## 5.2 Smoke Pack Crítico

El smoke pack curado vive en `scripts/config/critical-smoke-pack.json`.

Escenarios obligatorios:

- `cold_boot`
- `login`
- `offline_to_online`
- `sync_conflict`
- `export`
- `clinical_documents`

Objetivo: asegurar una ruta rápida y estable de validación operativa sin depender de toda la suite.

## 5.3 Perfil especialista

El perfil `doctor_specialist` ya no tiene un flujo de login o shell paralelo.

El modelo canónico de acceso general vive en [docs/AUTH_ACCESS_MODEL.md](../AUTH_ACCESS_MODEL.md).

Regresiones mínimas esperadas cuando una change toca auth, censo, documentos clínicos o handoff:

- login normal con Gmail
- acceso permitido solo si el correo existe en `config/roles`
- usuario sin rol no monta shell ni navbar
- acceso visible solo a `CENSUS` y `MEDICAL_HANDOFF`
- censo abreviado sin edición de datos censales
- documentos clínicos con edición de `draft`
- entrega médica editable solo en día actual

## 5.3 Release Confidence Pack

El pack versionado vive en `scripts/config/release-confidence-pack.json`.

Perfil blocking por defecto (`npm run test:release-confidence`):

- `runtime_smoke`
- `rules_ci`
- `emulator_sync_ci`
- `critical_coverage`
- `flow_performance`
- `e2e_critical_ci`

Perfil full (`npm run test:release-confidence:full`):

- `unit_critical`
- todo el perfil blocking

Regla de diseño:

- `unit_critical` queda fuera del perfil blocking porque hoy se solapa con `runtime_smoke` y `e2e_critical_ci`
- el perfil blocking debe contener solo pasos `blocking-tier`
- el perfil full existe para auditorías más profundas o corridas de diagnóstico

Objetivo: dejar una ruta blocking más compacta para release, sin perder una variante extendida cuando se necesite profundidad adicional.

## 5.4 Release Confidence Matrix

La matriz versionada vive en `scripts/config/release-confidence-matrix.json`.

Gobierna la trazabilidad entre:

- zonas de `critical coverage`
- escenarios del `critical smoke pack`
- `flow budgets`
- pasos blocking de `test:release-confidence`
- `ownerAreaId` hacia `technical-ownership-map`
- `validationSuites` que sirven de entrada rápida o regresión focalizada por subsistema

Artefactos:

- `reports/release-confidence-matrix.md`
- `reports/release-confidence-matrix.json`

Objetivo: que el pack blocking siga siendo chico, pero con cobertura explícita por área crítica y sin huecos no intencionales entre runtime, coverage y release gates.

## 6. Buenas prácticas

1. Usar mocks compartidos de `src/tests/setup.ts` cuando exista una variante oficial.
2. Evitar `any` en tests; preferir fixtures tipadas y `ApplicationOutcome` explícito.
3. Si aparece una falla E2E, migrar el spec a contratos estables (`data-testid`, ready states, errores visibles) antes de relajar assertions.
4. Si cambia el estándar operativo, actualizar [docs/CI_GATES_AND_FAILURE_RUNBOOKS.md](../CI_GATES_AND_FAILURE_RUNBOOKS.md).
5. Si cambia el smoke de preview o el grafo de chunks de arranque, actualizar también `scripts/config/guardrail-governance.json` para que CI, reportes y documentación sigan alineados.
