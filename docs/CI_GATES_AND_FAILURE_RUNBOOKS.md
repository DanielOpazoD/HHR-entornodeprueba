# CI Gates and Failure Runbooks

## Objetivo

Definir una ruta corta para desarrollo diario y una ruta blocking para merge/release sin duplicar checks caros.

## Punto de entrada recomendado

- Para elegir runbook por incidente o tipo de cambio: [docs/RUNBOOK_INDEX.md](./RUNBOOK_INDEX.md)
- Para comandos curados del repo: [docs/DEVELOPER_COMMANDS.md](./DEVELOPER_COMMANDS.md)

Si la change toca reglas generadas o documentación operativa, correr además:

- `npm run build:rules-assets` si cambias `firestore.rules` o `storage.rules`
- `npm run check:docs-drift`
- `npm run check:operational-runbooks`

## Gates activos

El job `critical-coverage-report` genera el artefacto una sola vez y ejecuta después
`check-critical-coverage.mjs`, bloqueando el PR si alguna zona queda bajo su baseline.
Los baselines son un ratchet del estado validado; no deben conservar valores ya
incumplidos ni rebajarse para ocultar una regresión nueva.

### `ci:inner-loop`

Usar cuando el cambio todavía está en iteración local.

Incluye:

- `npm run typecheck`
- `npm run lint -- --max-warnings 0`
- `npm run check:quality`
- `npm run test:unit:critical`

Salida esperada:

- feedback rápido sobre tipado, lint, guardrails estructurales y riesgos unitarios críticos.

### `ci:pre-merge`

Usar como verificación compacta obligatoria antes de merge.

Incluye:

- `npm run typecheck`
- `npm run lint -- --max-warnings 0`
- `npm run check:quality`
- `npm run test:ci:unit`

Salida esperada:

- contrato base de tipado, lint, guardrails y suite unitaria/integración de CI en verde antes de abrir o actualizar un PR.

### `ci:merge-gate`

Usar cuando una change toca código clínico, almacenamiento, auth, bundle o lazy loading.

Incluye:

- `npm run ci:pre-merge`
- `npm run lint:strict:core`
- `npm run check:critical-coverage`
- `npm run check:netlify-functions-bundle`
- `npm run build`
- `npm run ci:preview-gate`

### `ci:preview-gate`

Usar cuando se quiere validar específicamente el bundle productivo ya construido antes de merge o como diagnóstico de blank page.

Incluye:

- `npm run check:bundle-budget`
- `npm run check:chunk-graph`
- `npm run test:e2e:preview:census-bootstrap:built`

Salida esperada:

- cobertura crítica instrumentada sin regresión;
- build productivo válido;
- budgets de bundle dentro de los límites vigentes;
- preview local del bundle montando `root` sin blank page silenciosa.

Artefactos esperados cuando falla en CI:

- `reports/e2e/preview-bootstrap/`
- `reports/e2e/clinical-visual-release-report.json`
- `playwright-report/`
- `test-results/`

### `ci:release-gate`

Usar antes de release o para validar cambios con impacto en Firestore, emuladores, reglas o E2E críticos.

Incluye:

- `npm run ci:merge-gate`
- `npm run release:evidence:refresh`
- `npm run check:release-evidence`
- `npm run test:firestore:release:ci`

El gate regenera primero el paquete completo, incluido el smoke visual clínico y el
bundle que incorpora el manifiesto. Después `check:release-evidence` bloquea evidencia
formal generada desde un worktree sucio, reportes stale, signoff clínico incompleto,
smoke visual clínico faltante y `quality-metrics` con `flakeRiskFiles > 0`. Si falla por
flake-risk, corregir o aislar el test afectado antes de repetir `ci:release-gate`.

### `test:release-confidence`

Pack versionado compacto para release confidence, definido en `scripts/config/release-confidence-pack.json`.

Debe seguir cubriendo:

- `test:smoke:critical-runtime`
- `test:rules:ci`
- `test:emulator:sync:ci`
- `check:critical-coverage`
- `check:flow-performance-budget`
- `test:e2e:critical:ci`

El script extendido `test:release-confidence:full` agrega `test:unit:critical` cuando se quiere una corrida más profunda o diagnóstica.
La trazabilidad obligatoria por área crítica vive en `scripts/config/release-confidence-matrix.json` y se valida con `npm run check:release-confidence-matrix`.
El ownership técnico por subsistema crítico vive en `scripts/config/technical-ownership-map.json` y se valida con `npm run check:technical-ownership-map`.
El scorecard ejecutivo consolidado vive en `reports/release-readiness-scorecard.md` y se regenera con `npm run report:release-readiness-scorecard`.
La política formal de upgrades, excepciones y tipos de cambio vive en `scripts/config/sustainable-change-policy.json` y se valida con `npm run check:sustainable-change-policy`.
La clasificación compacta de guardrails blocking vs report-only vive en `scripts/config/guardrail-governance.json` y se valida con `npm run check:guardrail-governance`.
La clasificación de runtime de tests vive en `scripts/config/test-runtime-governance.json` y se valida con `npm run check:test-runtime-governance`.
El workflow `.github/workflows/nightly-test-runtime.yml` concentra suites largas en `workflow_dispatch`/`schedule`: `test:sync-load`, `test:release-confidence:full` y `test:e2e:clinical-stability:ci`.
El artifact `reports/test-runtime-governance.md` muestra budgets, PR vs nightly y señales de fixtures duplicadas para reducir tiempo con datos sin perder cobertura clínica crítica.
El balance de los 4 `unit-risk-shards` vive en `scripts/config/unit-shard-balance.json`, se valida con `npm run check:unit-shard-balance` y se evidencia en `reports/unit-shard-runtime-profile.md`.
Si un shard se vuelve dominante, correr `npm run profile:unit-shard-runtime`, revisar los archivos lentos del reporte y ajustar `perFileOverheadMs`, `durationHints`, `affinityGroups` o `lockedAssignments`; no mover tests clínicos PR-critical a nightly para maquillar runtime.
El runtime observado de GitHub Actions se evidencia en `reports/ci-runtime-observed-profile.md` y se valida con `npm run check:ci-runtime-telemetry`. En PR lo captura `ci-runtime-telemetry`, con permisos mínimos `actions: read`/`contents: read`, después de los gates principales. El collector `npm run collect:ci-runtime-observed-input` usa `GITHUB_RUN_ID`, `GITHUB_REPOSITORY` y `GITHUB_TOKEN` para escribir `reports/ci-runtime-observed-input.json`; luego el reporte compara esos tiempos reales contra `reports/unit-shard-runtime-profile.json`.
Este gate es advisory-first: no bloquea por falta de datos reales ni por una corrida aislada lenta; solo bloquea contratos rotos como JSON inválido, timestamps inválidos, shards duplicados/faltantes cuando el reporte declara datos observados o nombres imposibles de shard.
Si el observado contradice repetidamente el balance estimado, ajustar primero `durationHints`, `perFileOverheadMs`, `affinityGroups` o `lockedAssignments`, y recién después considerar cambios de suite. No reducir cobertura clínica crítica para bajar minutos. Si el reporte queda en `no_observed_ci_data` dentro de GitHub Actions, revisar que el job `ci-runtime-telemetry` haya ejecutado el collector antes del reporter y que el token tenga permiso de lectura de Actions.
El reporte de release readiness ya regenera también `guardrail-governance`; no debe depender de un artefacto previo manual.
CI regenera los snapshots report-only obligatorios con `npm run report:governance-snapshots` antes de ejecutar `check:quality`.
`release-readiness-scorecard` sigue siendo ejecutivo y obligatorio para release, pero ya no duplica bloqueo dentro de `check:quality` si las fuentes primarias siguen verdes.
`release-confidence-matrix` también pasa a report-only dentro del aggregate: sigue exigiéndose para trazabilidad y revisión técnica, pero no como bloqueo duplicado si el release pack y la cobertura primaria siguen verdes.
`technical-ownership-map` también pasa a report-only dentro del aggregate: sigue siendo obligatorio para ownership y trazabilidad operativa, pero no bloquea `check:quality` porque no cubre un riesgo primario distinto de los gates y runbooks ya activos.
`sustainable-change-policy` también pasa a report-only dentro del aggregate: sigue siendo obligatoria para upgrades, excepciones y definición de cambio seguro, pero no bloquea `check:quality` cuando los gates técnicos primarios ya cubren el riesgo efectivo.

Salida esperada:

- ruta blocking compacta y repetible para release;
- reglas, emulador sync y E2E críticos verdes en la misma corrida;
- sin duplicar en la ruta por defecto checks que ya quedan cubiertos por smoke/E2E críticos.

### Falla `check:release-confidence-matrix`

1. correr `npm run report:release-confidence-matrix`
2. revisar `reports/release-confidence-matrix.md`
3. confirmar que cada área crítica siga mapeada a:
   - un `ownerAreaId` válido de `technical-ownership-map`
   - una o más zonas de `critical coverage`, o evidencia equivalente de smoke/flow
   - una o más `validationSuites` con scripts reales para el loop diario o la regresión específica
   - al menos un paso blocking del release pack
4. si agregaste una zona nueva de coverage, un smoke nuevo o un flow budget nuevo, actualizar la matriz en la misma change
5. si agregaste un subsistema crítico nuevo, enlazarlo en la misma change con ownership y suites
6. no aceptar perfiles compactos sin trazabilidad explícita de qué área protegen

### Falla `check:technical-ownership-map`

1. correr `npm run report:technical-ownership-map`
2. revisar `reports/technical-ownership-map.md`
3. confirmar que cada subsistema crítico siga teniendo:
   - `owner` técnico
   - `primaryMetric`
   - al menos un `gate`
   - al menos un `runbook`
4. si agregaste un subsistema crítico nuevo o cambió el runbook operativo, actualizar el mapa en la misma change
5. no aceptar deuda crítica sin owner operativo explícito

### Falla `check:compatibility-import-governance`

1. correr `npm run report:compatibility-import-governance`
2. revisar `reports/compatibility-import-governance.md`
3. confirmar si el importer detectado es:
   - un consumidor legacy explícitamente tolerado;
   - una dependencia nueva no autorizada hacia un bridge transicional
4. si la dependencia nueva es legítima por migración activa, agregarla al inventario en `scripts/config/compatibility-governance.json` en la misma change
5. si no es legítima, mover el import al entrypoint canónico dueño y no al facade/bridge legacy
6. no aceptar nuevas dependencias productivas a compatibilidad transitoria sin excepción documentada

### Falla `check:serverless-sensitive-coverage`

1. correr `npm run report:serverless-sensitive-coverage`
2. revisar `reports/serverless-sensitive-coverage.md`
3. confirmar para cada Function sensible que sigan presentes:
   - archivo de Function
   - al menos un test de frontera dueño
   - documentación en `docs/SERVERLESS_SENSITIVE_CONTRACTS.md`
4. si agregaste una Function sensible nueva, registrarla en `scripts/config/serverless-sensitive-coverage.json` en la misma change
5. no aceptar endpoints sensibles sin test focalizado y contrato operativo documentado

### Falla `check:release-readiness-scorecard`

1. correr `npm run report:release-readiness-scorecard`
2. revisar `reports/release-readiness-scorecard.md`
3. confirmar que no falten reportes fuente ni haya indicadores degradados en:
   - calidad estructural
   - system confidence
   - readiness operativa
   - release confidence
   - ownership
   - compatibility governance
4. si el scorecard se degrada por un reporte base, corregir ese reporte o su fuente; no maquillar el scorecard
5. `compatibility_governance` puede tener `restrictedEntries=0` y seguir `ok` si `unauthorizedImports=0`; eso significa que no hay superficies restringidas activas que auditar en ese snapshot

### Falla `check:sustainable-change-policy`

1. correr `npm run report:sustainable-change-policy`
2. revisar `reports/sustainable-change-policy.md`
3. confirmar que sigan presentes:
   - los tipos de cambio canónicos
   - las reglas mínimas para upgrades
   - los campos obligatorios para excepciones
   - la relación con `Definition of Done`
4. si agregaste un tipo de cambio nuevo o una excepción nueva, actualizar esta policy en la misma change

### Falla `check:guardrail-governance`

1. correr `npm run report:guardrail-governance`
2. revisar `reports/guardrail-governance.md`
3. confirmar que:
   - `ci:inner-loop`, `ci:pre-merge`, `ci:merge-gate` y `ci:release-gate` sigan declarando exactamente los scripts protegidos
   - `test:release-confidence` siga cubriendo el pack blocking compacto
   - los reportes report-only sigan apuntando a artefactos reales
4. si agregaste un guardrail nuevo, decidir en la misma change si nace como blocking o report-only
5. no duplicar un mismo riesgo en varios gates sin justificación explícita

### Falla `check:dependency-vulnerabilities`

1. revisar `reports/security/dependency-audit.md`
2. identificar si el fallo viene de:
   - `root`
   - `functions`
   - ambos workspaces
3. distinguir si la categoría es:
   - `high_or_critical_vulnerabilities`
   - `certificate_untrusted`
   - `registry_policy_blocked`
   - `network_unavailable`
   - `invalid_output`
   - `missing_inputs`
4. si hay vulnerabilidades reales:
   - priorizar upgrade de dependencias productivas
   - documentar excepciones solo si el upgrade rompe compatibilidad y existe mitigación temporal explícita
5. si el fallo es `certificate_untrusted`:
   - revisar si el reporte indica `Retried with system CA: yes`
   - correr `NODE_OPTIONS=--use-system-ca npm run check:dependency-vulnerabilities`
   - revisar `npm config get cafile`
   - confirmar conectividad de audit con `npm ping --registry=https://registry.npmjs.org`
   - revisar la sección `Reproducibility` del reporte y comparar contra el último workflow de GitHub Actions para el mismo commit
   - si la red usa CA corporativa, configurar un `cafile` confiable en npm o en el entorno local
   - no usar `npm config set strict-ssl false`
6. si el fallo es de red o registry:
   - reintentar el workflow
   - no marcar la app como segura por ausencia de reporte
7. si root app o `functions` quedan con hallazgos `low`/`moderate` pero sin `high` ni `critical`:
   - revisar [docs/FUNCTIONS_DEPENDENCY_ACCEPTANCE.md](./FUNCTIONS_DEPENDENCY_ACCEPTANCE.md)
   - confirmar que no aparecieron `high`, `critical` ni nuevos hallazgos directos fuera del árbol aceptado
   - tratar el estado como deuda aceptada temporalmente, no como bloqueo inmediato ni como limpieza automática vía overrides inseguros

El reporte `reports/security/dependency-audit.md` debe conservar comandos de reproducción local, evidencia CI esperada y acciones prohibidas. Si el audit falla por TLS/red local, eso bloquea la afirmación de seguridad local hasta tener evidencia CI equivalente para el mismo commit.

## Qué hacer cuando falla

### Falla `check:bundle-budget`

1. correr `npm run build`
2. revisar el warning de `scripts/check-bundle-budget.mjs` y el tamaño real en `dist/assets`
3. identificar si el crecimiento viene del entry principal, de un chunk lazy o de un vendor pesado
4. preferir:
   - cortar imports cruzados;
   - mover librerías pesadas fuera del camino inicial;
   - dividir use cases/UI por flujo
5. no subir el threshold como primera respuesta

### Falla `check:chunk-graph`

1. correr `npm run build`
2. correr `npm run check:chunk-graph`
3. si aparece un ciclo vendor↔vendor o vendor→feature:
   - revisar `scripts/config/chunkingPolicy.ts`
   - revisar imports estáticos reintroducidos en el shell
   - confirmar que `firebase/app` y `firebase/auth` sigan juntos en `vendor-firebase-core`
4. no aceptar un split “más prolijo” si vuelve a abrir un ciclo productivo

### Falla `test:e2e:preview:census-bootstrap:built`

1. correr `npm run build`
2. correr `npm run test:e2e:preview:census-bootstrap:built`
3. revisar artifacts de Playwright:
   - `playwright-report`
   - `test-results`
4. distinguir si la caída viene de:
   - `pageerror` fatal,
   - `Cannot access '<symbol>' before initialization`,
   - `ChunkLoadError` o `Failed to fetch dynamically imported module`,
   - un root que nunca monta
5. si el fallo menciona chunks o bootstrap, revisar primero `check:chunk-graph`, budgets de startup y `clientBootstrapRecovery`

### Falla `check:critical-coverage`

1. correr `npm run test:coverage:critical`
2. revisar [reports/critical-coverage.md](./../reports/critical-coverage.md)
3. ubicar la zona degradada en `scripts/config/critical-coverage-thresholds.json`
4. decidir si la regresión es:
   - pérdida real de cobertura/invariante;
   - archivo nuevo sin tests;
   - refactor que movió líneas entre zonas
5. primero corregir tests o mapping de zona; solo después actualizar baseline si la nueva medición quedó validada a propósito
6. si el baseline ya estaba incumplido antes del cambio, documentar la corrida que lo demuestra, ajustarlo al valor actual validado y conservar el job bloqueante para impedir nuevas caídas

### Falla `check:test-failure-catalog`

1. revisar `scripts/config/test-failure-catalog.json`
2. confirmar que toda falla conocida tenga `owner`, `classification`, `status`, `sla` y `reason`
3. si una entrada es `flaky`, debe existir también en `scripts/config/flaky-quarantine.json`
4. si una falla fue corregida, marcarla `fixed` o removerla junto con su cuarentena asociada
5. no aceptar fallos conocidos fuera del catálogo versionado

### Falla `test:firestore:release:ci`

1. distinguir si falla `rules`, `emulator:sync`, `emulator:ui` o `e2e:critical`
2. si falla `rules`, validar contratos de schema y paths Firestore antes de tocar tests
3. si falla `emulator:sync/ui`, revisar sync queue, repositorios, IndexedDB o adapters Firestore
4. regenerar snapshots/reportes operativos si el cambio modificó budgets o recovery policies

### Falla `test:e2e:critical`

1. validar primero que no sea un locator frágil o contrato de pantalla roto
2. preferir `data-testid`, estados visibles y señales de readiness estables
3. si el problema es rendimiento, revisar bundle por flujo antes de relajar el test
4. si el cambio es intencional, actualizar el spec con el nuevo contrato explícito

### Falla en perfil especialista

1. validar primero que el rol `doctor_specialist` siga entrando por login normal y no por un flujo alternativo
2. revisar que `CENSUS` y `MEDICAL_HANDOFF` sigan siendo los únicos módulos visibles
3. si falla handoff, confirmar que la restricción de edición por día actual no se haya roto
4. si falla clinical-documents, revisar permisos de `draft` en frontend y Firestore Rules

### Falla de login / Gestión de Roles

1. revisar primero [docs/AUTH_ACCESS_MODEL.md](./AUTH_ACCESS_MODEL.md)
2. usar [docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md](./RUNBOOK_AUTH_ACCESS_INCIDENTS.md) como guía operativa corta
3. confirmar que el correo exista en `config/roles` con un rol válido
4. confirmar que el frontend ya use resolución por callable y no lectura directa del documento
5. confirmar que functions y `firestore.rules` publicadas correspondan al mismo modelo
6. si el usuario fue removido, verificar que el login termine en `signOut` y no en shell vacío

### Falla `check:flow-performance-budget`

1. correr `npm run test:e2e:flow-performance`
2. revisar `reports/e2e/flow-performance-budget.md` y `reports/e2e/flow-performance-budget-summary.json`, especialmente `status` por flujo y `breakdown`
3. distinguir si el flujo rompe:
   - `enforcedMaxMs`: deuda blocking;
   - `targetMs`: gap conocido, todavía no blocking
4. si el flujo queda en `near-limit`, corregir preload o trabajo no crítico antes de aceptar el margen
5. si el gap principal es `censoVisibleMs` o `clinicalDocumentsVisibleMs`, revisar bootstrap local, hydration, tabla y lazy loading antes de subir el límite

## Regla práctica

- cambio local chico: `ci:inner-loop`
- cambio funcional antes de abrir o actualizar PR: `ci:pre-merge`
- cambio funcional o refactor con impacto real: `ci:merge-gate`
- cambio de release, Firebase o UX crítica: `ci:release-gate`
