# CI Gates and Failure Runbooks

Para el rollout regional de `applyRayenClinicalEnrichmentBatch`, el deploy debe
verificar `southamerica-east1` y `us-central1`: la segunda conserva los clientes
anteriores. No cambiar el enrutamiento del cliente hasta verificar el despliegue
del head mergeado. Ejecutar merge gate y release confidence para el cambio del
handler; conservar memoria, timeout, autoridad, recibos y transacción.

`ACTIVE` y la presencia en `functions:list` no prueban invocabilidad. Si el primer
deploy regional falla en `setIamPolicy`, mantener el cliente anterior y revisar
el binding de invocación del recurso nuevo. En `hhr-pruebas`, el endpoint anterior
usa `roles/cloudfunctions.invoker` para `allUsers`; replicar ese binding requiere
autorización puntual, preservando los demás bindings y su `etag`. No conceder
Cloud Functions Admin al deployer para resolver este incidente. Comprobar después
una llamada autenticada idempotente y el rechazo `UNAUTHENTICATED` de una petición
sintética válida sin sesión. La validación de payload antecede a Auth: un 400
`INVALID_ARGUMENT` no acredita ese rechazo de autenticación.

El cliente clínico usa el runtime regional existente con el timeout de 20 s.
No implementar fallback a otra región tras una respuesta ambigua: los reintentos
clínicos conservan su política y recibos existentes. Para rollback, revertir solo
el enrutamiento del cliente; el endpoint de Estados Unidos sigue disponible.

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

Los fixtures de autenticación E2E esperan una superficie visible de login o el
menú `authenticated-user-menu-button` después de `domcontentloaded`. No esperan `networkidle`:
las conexiones de Firestore pueden seguir abiertas con la aplicación lista.
La ausencia de ambas superficies falla; ver el shell no acredita haber cargado
el censo. Cada escenario conserva sus assertions de registro, permisos y
persistencia. Owner: test infrastructure. Para rollback, revertir sólo este
cambio de fixtures; no cambiar timeouts, retries ni el pack crítico. Comparar
los 38 escenarios existentes; el pack añade tres regresiones de superficies
ocultas/visibles y shell previo al menú autenticado. Declarar fallos/reintentos además del tiempo total.

Referencia: [esperas de Playwright](https://playwright.dev/docs/api/class-page#page-wait-for-load-state).

Las 21 suites de contratos de CI en `src/tests/build` auditadas sin uso de DOM
declaran `@vitest-environment node` por archivo; las pruebas de UI conservan jsdom
y el setup global sigue igual. No ampliar la lista por nombre sin revisar sus
imports y comportamiento. Seis ejecuciones locales alternadas (dos workers,
99 tests por ejecución) dieron medianas de 29.339 s en jsdom y 12.124 s en Node;
la carga del equipo varió. Es evidencia de esta cohorte, no del pipeline completo.
Owner: test infrastructure. Rollback: retirar esas anotaciones; conservar workers,
aislamiento, tests y presupuestos. [Entornos de Vitest](https://vitest.dev/config/environment).

El runner `test:ci:unit:shard` sólo aprueba si el proceso de Vitest termina con
código cero. Una señal o un error al iniciar el ejecutable produce fallo y un
diagnóstico `Runner did not complete`; no acredita que las pruebas hayan terminado.
`unitShardRunner.test.ts` ejecuta el runner real con procesos controlados para cubrir
éxito, fallo, interrupción y ejecutable ausente. Revertir el cambio del runner restaura
la política anterior; no modifica aplicación, datos clínicos ni umbrales de prueba.

El job `critical-coverage-report` genera el artefacto una sola vez y ejecuta después
`check-critical-coverage.mjs`, bloqueando el PR si alguna zona queda bajo su baseline.
Los baselines son un ratchet del estado validado; no deben conservar valores ya
incumplidos ni rebajarse para ocultar una regresión nueva.

### Alcance automático de CI en pull requests

El job `ci-scope` clasifica cada PR antes de iniciar los gates costosos. Lee el
clasificador y su configuración desde el SHA base confiable, compara contra el SHA
inmutable del candidato y falla de forma conservadora: un error, una ruta ambigua o
una combinación no permitida ejecuta la ruta `full`.

| Alcance          | Cambios admitidos                                                                              | Validación blocking                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `docs-only`      | `docs/**` salvo `docs/api/**`, o Markdown raíz expresamente permitido                          | `check:docs-drift`, `check:operational-runbooks` y `ci-summary`                                             |
| `functions-only` | Fuente bajo `functions/**` y scripts de verificación permitidos; excluye ambos manifiestos npm | tests de Functions, despliegue, borrado y regiones; contratos serverless; runtime PDF clínico; `ci-summary` |
| `full`           | Código de aplicación, dependencias, configuración, reglas, cambios mixtos o cualquier fallback | matriz completa de calidad, shards, sincronización, reglas, E2E, build, rendimiento y readiness             |

Borrados, renombres, más de 50 archivos, documentación API generada, cambios en
`package.json`/lockfiles y eventos `push` siempre usan `full`. `ci-summary` exige que
los gates enfocados terminen en `success` y que los jobs completos estén exactamente
en `skipped`; así, un salto inesperado también falla.

Esta clasificación reduce el tiempo de feedback del PR. No cambia la selección local:
usar el comando más pequeño que cubra el riesgo durante la iteración y ampliar a
`ci:pre-merge`, `ci:merge-gate` o `ci:release-gate` según el impacto.

### Evidencia final de rendimiento

`final-confidence-and-readiness` espera a `e2e-critical-emulator` y descarga su artefacto
`flow-performance-evidence` de la misma ejecución, sin seleccionar otra rama ni un run anterior.
Valida el reporte Playwright (sin fallos, interrupciones ni recuperaciones por reintento) y los presupuestos
antes de regenerar salud operativa, confianza y readiness. Publica también las mediciones fuente. `postmerge-evidence` reutiliza y valida el mismo
artefacto antes de regenerar los informes de main.
Una evidencia ausente o inválida bloquea esa etapa; un incumplimiento de objetivos conserva su
estado degradado y no se convierte en aprobado para mejorar la nota.

### Entorno de E2E crítico

El build previo y el servidor de `playwright.emulator-critical.config.ts` usan
`scripts/config/criticalE2EEnvironment.mjs`: configuración Firebase demo, emulador Firestore
loopback y sin credenciales o flags `VITE_*` heredados. En modo E2E Vite no carga archivos
dotenv personales. El servidor de prueba siempre es propio; un puerto ocupado falla en lugar
de reutilizar una aplicación cuya versión o configuración se desconoce.

Usar `npm run test:e2e:critical:ci` o `npm run test:e2e:flow-performance:gate` sin vaciar
manualmente el cliente Google. Se conserva `FIRESTORE_EMULATOR_HOST` local para el puerto
dinámico del runner. La lectura autenticada admite también `FIREBASE_AUTH_EMULATOR_HOST`,
validado como loopback y convertido a URL para el frontend. Esto aísla la configuración frontend de estas suites; no sustituye las
intercepciones de fuentes externas ni los guards de los emuladores.

### Evidencia de persistencia en navegador

`census-persistence-reload.spec.ts` y `legacy-firebase-compat.spec.ts` verifican la
petición producida al guardar desde la UI, reciben una respuesta de la autoridad
controlada y esperan que la aplicación actualice el espejo local antes de recargar.
No deben escribir los valores esperados en localStorage o IndexedDB después de la
acción que intentan validar. Una corrección de nombre o de formato del mismo RUT
debe conservar el episodio y el diagnóstico; el reemplazo real mantiene la limpieza
clínica y los pasaportes conservan su comparación sin eliminar letras o separadores.

La ruta controlada modela el servidor para probar el cliente. No acredita por sí sola
transacciones reales, concurrencia de Functions ni persistencia remota: esas garantías
corresponden a las pruebas de emulador y autoridad clínica. Las pruebas que inyectan
snapshots externos prueban reconciliación de lecturas, no dos escritores reales.
El rechazo, retry acotado y rollback de cama/cuna ya se cubren en
`bed-crib-lifecycle-critical.spec.ts`; la recuperación de cola tras recarga, en
`night-admission-sync-recovery-critical.spec.ts`.

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
El gate de rendimiento del censo usa 5 muestras por escenario en PR y conserva 30 en eventos que no son PR, incluidos los `push` a `main` y `develop`. El muestreo corto detecta regresiones durante revisión; el muestreo largo de los eventos que no son PR mantiene la evidencia estable sin cobrar ese costo en cada iteración.
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

### Parpadeo del censo al ingresar o recargar

- Distinguir una navegación nueva de un remontaje React: medir identidad de la
  cabecera y transiciones de auth, sin registrar contenido clínico.
- Revisar el eco del primer observer frente a la sesión ya resuelta y cualquier
  provider diferido que cambie la ascendencia del chrome.
- Ejecutar `AppContent.entrypoint.test.tsx` y `useAuthState.crossTabLogout.test.ts`;
  confirmar que un cambio de permisos sigue readmitiendo y que logout invalida
  admisiones pendientes. No suprimir eventos posteriores para esconder el síntoma.
- Reproducir Google y F5 en el entorno verificado; retirar instrumentación temporal.

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

- cambio solo documental: `npm run check:docs-drift && npm run check:operational-runbooks`
- cambio solo en fuente de Functions: ejecutar los tests de `src/tests/functions` y los contratos serverless afectados
- cambio local chico: `ci:inner-loop`
- cambio funcional antes de abrir o actualizar PR: `ci:pre-merge`
- cambio funcional o refactor con impacto real: `ci:merge-gate`
- cambio de release, Firebase o UX crítica: `ci:release-gate`

## Actualizaciones de dependencias

Dependabot agrupa parches y versiones menores por superficie: React, documentos,
datos, APIs cloud, UI, medios, Storybook, Vitest, PWA, Vite, lint, pruebas de navegador,
Firebase, CSS, TypeScript/documentación y tooling del repositorio. Una dependencia
sin grupo recibe un PR individual. Los cambios mayores siguen separados.

Vite 8 permanece pausado hasta que Storybook instalado admita ese peer; Vitest 5
permanece pausado mientras `@storybook/addon-vitest` requiera Vitest 4. Al retirar una
pausa, actualizar el toolchain relacionado en conjunto y exigir `npm ci`, los gates
enfocados del área y CI `full`. El workspace de Functions conserva su grupo menor
independiente. Los manifiestos de Functions siempre disparan `full`.

## Superseded pull-request runs

`CI/CD Pipeline` and `Preview Validation` share a concurrency group only for revisions
of the same pull request within the same workflow. A newer revision cancels that
PR's obsolete run; reviewers must inspect checks for the current head SHA.
Push validations use a unique run ID, preserving every `main` and `develop` run
(including pending runs). This does not change jobs, required checks, or test scope.

### Reutilización acotada de dependencias instaladas

`quality-static-base` guarda `node_modules` inmediatamente después de `npm ci`.
`quality-static-governance-snapshots`, `build-budget` y `lighthouse-ci` reutilizan
esa instalación mediante `.github/actions/setup-ci-dependencies`; sus dependencias
entre jobs, pruebas y umbrales permanecen iguales. La clave exige imagen/revisión del runner, sistema,
arquitectura, versión exacta de Node, manifiesto, lockfile, configuración npm y
versión de la propia acción. No se aceptan coincidencias por prefijo.

`API Documentation` usa la misma acción bajo Node 22, como exige el manifest
raíz; Node 20 emitía `EBADENGINE`. Conserva su scope `full`, permisos de lectura,
generación TypeDoc y publicación de artefactos. Es otro consumidor, no un escritor
ni un job dependiente del productor. Referencia CI 36931460428: instalación 64 s,
generación 29 s; informar hit/miss y tiempo final sin prometer ahorro global.
Owner: CI documentation tooling. Rollback: revertir el cambio del job.

Si no hay coincidencia exacta o falla la restauración, se ejecuta `npm ci` con la
caché habitual de descargas de npm. Un fallo de instalación sigue bloqueando CI;
solo guardar/restaurar la caché es opcional. No se guardan datos clínicos,
credenciales ni el resultado de tests/builds. El único lifecycle del proyecto
es `prepare: husky`; las comprobaciones no dependen de hooks Git instalados.

Motivo medido: en los runs `36484350746` y `36489067347`, la instalación en las
etapas consecutivas consumía aproximadamente 55–66 segundos por etapa. Comparar
los tiempos del paso `Setup CI dependencies` y del workflow completo, separando
la primera instalación de las restauraciones; una reducción del paso no garantiza
igual reducción global si otra rama pasa a dominar el tiempo. Reversión: reemplazar
la acción por `setup-node` + `npm ci` en esos cuatro jobs y retirar su acción local.

### Evidencia de reconexión y conflictos (2026-09-29)

`multiuser-offline-conflict.spec.ts` prepara sólo el estado inicial en IndexedDB.
Después comprueba que la edición visible sin red conserva la base persistida hasta
reconectar; la mutación pausada debe entonces guardar por el camino de la aplicación.
El segundo contexto edita desde la UI, se inspecciona su petición callable y se acepta
con `dailyRecordAuthorityRoute`. El snapshot que recibe el primer contexto procede
del guardado aceptado del segundo, no de valores esperados escritos por el test.
`sync-conflict-resolution.spec.ts` tampoco rellena el almacenamiento después de editar.

Estas pruebas usan autoridad remota controlada y una recarga con snapshot explícito:
no prueban reproducción automática de una cola offline, entrega entre navegadores
por Firestore ni resolución CAS de dos escritores reales. La concurrencia real se
verifica separadamente en `sync-concurrency.emulator.test.ts` (versiones, hidratación,
movimientos sin duplicación y retiro de dispositivos) y
`specialty-clinical-concurrency.emulator.test.ts` (autoridad clínica, decisiones
manuales de especialidad y cambios de cama/cuna). No declarar una edición en memoria
como guardado durable, ni sembrar el resultado para ocultar una mutación pausada.

### Integridad de los reportes Playwright

`check-playwright-report-clean.mjs` exige contadores enteros no negativos y al menos
una prueba ejecutada: un informe con sólo pruebas omitidas no acredita el flujo.
Los contadores `expected`, `unexpected` y `flaky` son obligatorios; `interrupted` y
`skipped` pueden faltar por compatibilidad con los reportes existentes. Un resultado
recuperado mediante retry sigue bloqueando por `flaky`, igual que antes.

También se rechaza cualquier error global del reporte, incluso si todas las pruebas
registradas aprobaron: un fallo de `globalTeardown` aparece en `errors` sin aumentar
`unexpected`. Una raíz JSON inválida o un `errors` presente que no sea array tampoco
acredita una ejecución limpia. Se conserva compatibilidad con reportes anteriores
que omiten `errors`; una lista vacía es evidencia válida. El gate resume el número de
errores sin copiar sus mensajes o posibles datos sensibles al diagnóstico.

El indicador estático `flakeRiskFiles` de `quality-metrics` detecta patrones de reloj,
aleatoriedad y temporizadores sin controles reconocidos. No equivale al número de
pruebas que fallaron intermitentemente en una ejecución: ese resultado se consulta en
los reportes de test. No reducir umbrales ni añadir marcas `@flake-safe` sólo para
mejorar el score. Se retiró `seedPersistedBedFields`, sin consumidores después de
corregir los E2E de reconexión; las pruebas deben preparar su estado inicial y luego
observar el guardado de la aplicación.

### Reloj de fixtures de autoridad (2026-10-01)

Los tests de autoridad estructural y de especialidad fijan únicamente `Date`, no
los temporizadores ni la E/S. La fecha del fixture y las guardas reales del callable
comparten un instante estable. Los escenarios fuera de la ventana de edición
avanzan explícitamente la fecha antes de invocar el handler; los vencimientos de
consulta Jev siguen verificando aceptación, rechazo y recuperación. Cada test
restaura el reloj, sin marcas `@flake-safe` ni cambios en los umbrales del gate.

### Esperas observables de tests (2026-10-01)

En relés MV3, entregar respuestas sólo después de observar la solicitud emitida
y esperar el mensaje o callback terminal exacto. La reinyección verifica además
el anuncio de inicialización antes de limpiar la lista de mensajes. En aislamiento
de sesiones, mantener una promesa de limpieza/cierre retenida y una señal explícita
de inicio; las dos ventanas deben alcanzar el Web Lock antes de liberarla.

Las pruebas de QueryClient fijan el reloj antes de crear la caché y lo avanzan según
el escenario; IndexedDB mantiene sus temporizadores nativos. Los fixtures de código
manual deben tener ingreso anterior a captura también en el caso expirado. El
helper de login ya controla timers: su reloj inicial y el lock del test son ahora
explícitos. No se cambia el detector de flake-risk ni se añaden exenciones.

### Atribución interna de transacciones clínicas

El desglose numérico `transactionTimingsMs` está descrito en
[el protocolo de medición](./operations/sync-session-performance.md). Se acumulan
intentos fallidos y exitosos; el tiempo externo al callback incluye trabajo del SDK
y no acredita una demora de commit aislada. Verificar lectura fallida, replay exacto,
auditoría y retry con reloj monotónico inyectado antes de usar las cifras.

## Exportación detenida antes de generar el archivo

La espera conserva su límite de 2,5 s y devuelve un resultado explícito. Si el
censo sigue guardándose, falló el guardado o cambió el día, la acción termina con
un aviso recuperable; repetirla cuando el estado esté resuelto. No aumentar el
límite ni exportar el registro anterior para ocultar el incidente. Esta barrera
coordina mutaciones locales y no certifica que la copia remota esté actualizada;
los controles de Storage y sus resultados parciales conservan sus contratos.

Regresiones: `useAppContentRuntime.test.tsx`, `useExportManager.test.ts` y
`exportReadinessController.test.ts`. El controlador cubre la espera y la segunda
comprobación; el hook cubre PDF, Excel, impresión y respaldo confirmado. Aplicar
`ci:merge-gate` y el pack blocking de `test:release-confidence`, reutilizando sólo
controles ya aprobados sobre el mismo código y configuración.

## Detalle de signos o scores no disponible

El censo mantiene sus valores aunque falle la carga del módulo de detalle.
El cuadro informa el fallo y permite cerrarlo; no recarga automáticamente una
edición activa ni inventa resultados. Recargar la aplicación cuando sea seguro
si un despliegue dejó un módulo anterior no disponible. Los chunks de detalle
siguen incluidos en el precache de producción para conservar su uso sin conexión.

`ClinicalDetailLoading.test.tsx` comprueba importación bajo demanda, cancelación,
respuesta tardía y aislamiento del fallo. Las pruebas de `VitalsCell` y
`ScoresCell` verifican el contenido clínico tras la carga. La medición de Rollup
del 01-10-2026 redujo el chunk del censo de 330.905 a 318.340 bytes y su unión
estática con el shell de 2.238.015 a 2.225.451 bytes (misma configuración local).
Es una reducción de JavaScript inicial, no una medición de latencia de usuarios.

## Historial de movimientos: lectura completa y cancelación

La búsqueda global consulta todo el historial remoto con páginas de 20 censos,
orden descendente por `date` y cursor del último documento, incluido su desempate
por ID. No usa offsets ni limita la antigüedad. El contador indica censos revisados;
la cronología derivada se publica sólo al terminar todas las páginas. Mientras
se lee, permanece disponible la cronología del maestro de pacientes.

Volver a resultados, cerrar el cuadro, cambiar paciente o versión de su maestro
cancela el avance. Firestore no cancela la solicitud ya en vuelo; su respuesta
se descarta y no se inicia otra página. Un fallo posterior descarta el prefijo
remoto y muestra el historial local como parcial, sin cachearlo como completo.
La búsqueda no escribe en la caché editable del censo. Los snapshots retenidos
para armar movimientos excluyen notas, signos y documentos clínicos.

Diagnóstico de sólo lectura del 01-10-2026 en `hhr-pruebas`: 305 documentos
representaron 31.225.956 bytes serializados; una página de 20, 5.327.028 bytes.
Estas cifras justifican limitar el trabajo abandonado; no demuestran menor tiempo
de completar toda la historia. Varias consultas añaden viajes de red y no forman
un snapshot atómico entre páginas. No usar esta vista de lectura para autorizar
escrituras. Cursor documentado por [Firebase](https://firebase.google.com/docs/firestore/query-data/query-cursors).

Regresiones: `patientHistoryPages`, `firestoreRecordQueries` y
`usePatientSelectionCancellation`, además de paridad de historia, RN y rangos.
Verificar cierre/desmontaje, versiones del mismo RUT, empate de fechas, fallo de
una página y respuesta tardía. Aplicar merge gate y controles blocking de release.

# Censo: aislamiento de renders de dotación y movimientos

`DailyRecordFragmentRendering` usa el proveedor real: veinte ediciones inmutables
de camas y revisión mantenían 21 renders de dotación/movimientos; ahora conservan
uno mientras camas y datos completos publican las 21 revisiones. Las dependencias
son los campos ya existentes, sin comparadores profundos ni otro almacén.
`CensusRegisterRendering` añade JSX nuevo del padre y comprueba el subárbol real de
registros (presentación pesada sustituida): también pasa de 21 a un render por
sección. Fecha, movimientos, permisos, modal y callback vigente siguen propagándose.

Ante datos visuales obsoletos, ejecutar ambas regresiones y los tests de Altas,
Traslados y Hospitalización Diurna; verificar que la escritura reemplaza las
colecciones inmutablemente y que no se eliminó una dependencia relevante.
El encabezado conserva su registro completo para el portal de entrega de turno;
las revisiones usadas por las acciones clínicas no se suprimen. Esta evidencia
reduce trabajo repetido; no es una medición comparativa de tiempo o INP de usuario.

La fixture multiusuario espera explícitamente a que la aplicación cree el almacén
`dailyRecords` antes de sembrar su estado inicial. La visibilidad de auth no prueba
readiness de IndexedDB; abrir una base inexistente desde el test crea un esquema
vacío y compite con Dexie. No se escriben ediciones esperadas desde la fixture.

### Retirar duplicados sin perder escenarios (2026-10-01)

Owner: infraestructura de tests HHR. Se conserva una prueba por cada contrato
único; un nombre antiguo de archivo no demuestra que el comportamiento haya desaparecido.
La cohorte de censo/handoff pasa de 75 a 71 tests al retirar cuatro cuerpos idénticos:

| Caso retirado                                                 | Caso que conserva las mismas entradas y aserciones                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Handoff: URL en `medicalPatientHandoffViewController.test.ts` | `domain/handoff/view.test.ts`: scope y especialidad desde URL       |
| `useCensusLogic`: fetch de fechas al montar                   | Comprobación del día previo: misma llamada a `useCensusPromptState` |
| Admisión: reparación de `firstSeenDate` obsoleto              | Reparación de `firstSeenDate` con hora presente y fecha corregida   |
| Rayen: paciente ausente del snapshot completo                 | No inferir un alta simple; conservar alta administrativa pendiente  |

Las dos variantes útiles de handoff con clasificación UPC booleana se trasladan
al test del dominio, separadas de los casos con checklist. No se cambia código
clínico, exclusiones, cobertura exigida ni selección de packs. Rollback: revertir
el PR; para nuevas retiradas, comparar fixtures/hooks/entradas/aserciones y ejecutar
los casos conservados, además de los controles del head definitivo.

### Setup DOM sólo para suites con document (2026-10-01)

El setup compartido carga React Testing Library, matchers DOM y su cleanup sólo
cuando el entorno ofrece `document`. IndexedDB simulado, storage y los mocks de
Firebase/auth permanecen disponibles en Node y jsdom; no cambia configuración de
Vitest, aislamiento, concurrencia ni selección de tests.
El adaptador oficial de jest-dom para Vitest registra los matchers y sus tipos;
las aserciones de `z-index` comparan texto CSS conservando sus valores originales.

Medición local: Node 22.22.2, 20 suites Node, las mismas 96 pruebas, dos workers,
seis procesos nuevos alternados antes/después (A-B-B-A-A-B). Medianas: 50,8 s
antes y 26,6 s después; rangos 28,3–53,0 s y 19,4–27,3 s. La carga del equipo
varía: el ahorro corresponde a esta cohorte, no al CI completo. Los tests de UI,
auth, persistencia y limpieza deben seguir pasando antes del cierre.
Owner: infraestructura de tests HHR. Rollback: revertir el PR para restaurar
imports DOM incondicionales; no reducir el pack para conservar una cifra de tiempo.
Referencias: [setupFiles de Vitest](https://vitest.dev/config/setupfiles) y
[cleanup de React Testing Library](https://testing-library.com/docs/react-testing-library/api/#cleanup).

### Canal entre pestañas: comprobar mensajes y cleanup reales (2026-10-02)

`authBroadcastChannel` utiliza una instancia simulada por caso y un módulo recién
cargado; nunca abre un BroadcastChannel nativo durante estas pruebas. Comprueba
los payloads de actividad/logout/sync, la generación admitida, la reutilización
del canal, el filtrado de mensajes entregados por la propia pestaña y la retirada
del listener exacto sin desuscribir otros consumidores. Se mantiene degradación
ante API ausente o constructor fallido. El descriptor global original se restaura
sin retirar fixtures compartidos de storage/auth.

Owner: infraestructura de tests/auth HHR. Estos casos reemplazan comprobaciones
vacías o que sólo comprobaban no lanzar errores; no cambian el protocolo real.
Validar también `useAuthState.crossTabLogout` y `sessionActivityMonitor`.
Rollback: revertir el PR; no convertir de nuevo payloads o limpieza en aserciones
constantes para silenciar una regresión.

### Telemetría CLI sin modificar reportes versionados (2026-10-02)

`ciRuntimeTelemetryScripts` ejecuta el script real con una ruta absoluta y un
`cwd` temporal distinto por entrada. No cambia el directorio global del proceso
de Vitest ni copia algoritmos del CLI. El perfil estimado versionado se copia como
fixture de entrada y se comprueba la comparación estimado/observado real.
Los JSON/Markdown generados se leen dentro
del workspace y se eliminan al terminar el caso, incluidos los fallos de parsing.
Se preservan las comprobaciones de errores accionables y metadatos del colector;
un caso adicional comprueba que otra ejecución no sobrescribe el primer reporte.

Owner: infraestructura de tests/CI HHR. Los reportes del repositorio deben conservar
sus bytes antes/después de esta cohorte. No regenerar artefactos versionados como
efecto lateral de un test. Rollback: revertir el PR y restaurar sólo reportes
generados por la propia ejecución; no descartar modificaciones ajenas.

### PDF: probar el servicio, no copias de su algoritmo (2026-10-02)

Los siete casos de `pdfStorageService` ejecutan ahora `createPdfStorageService`,
`listFilesInMonth` y `listFilesInMonthWithReport` reales. Se sustituyen objetos
literales de tipo, regex copiados y concatenación local de rutas por comprobaciones
de ruta para ambos turnos, parsing del formato actual y legacy, URL/metadatos,
fallback de timestamp y reporte de nombre no reconocido sin perder archivos válidos.

Firebase Storage se simula y el runtime ya existente se inyecta explícitamente;
no se llama a servicios remotos ni se exportan helpers privados para facilitar el
test. Los timers de consulta se simulan y limpian por caso. Se retira el mock de
una ruta inexistente a Firebase. `pdfStorageRuntime` conserva su cobertura de
permisos, fechas inválidas y fallos de consulta/mutación sin modificar el pack crítico.
Owner: infraestructura de tests/backup HHR. Rollback: revertir el PR; no reemplazar
una regresión del servicio por volver a comprobar una copia del algoritmo.

### Handshake Ficha Médico con reloj controlado (2026-10-02)

Los casos de versión/generación conservan sus variantes y ejecutan el relay real
en VM con timers de Vitest por caso. El probe no responde antes de 4500 ms; salud
no vence antes de 4000 ms y descarta la respuesta tardía. No se duerme 4,5 segundos
reales ni se amplía el timeout de Vitest. Los deadlines inertes que el relay deja
tras responder se eliminan al terminar cada caso; no se cambia la extensión.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.

### Suscripciones del repositorio con entrega explícita (2026-10-02)

Los casos de realtime en `dailyRecordRepositorySyncService` esperan la entrega del
callback real mediante una promesa del fixture; no dependen de dormir un turno ni
de adivinar el número de microtareas. Cada suscripción se cierra al terminar el caso.
Los mocks de IndexedDB, loader remoto y suscripción recuperan un estado independiente
antes de cada test, incluidos los casos de unsubscribe con una lectura pendiente.
Conserva las 11 comprobaciones de consistencia, cache-only y protección tras cierre.
Owner: infraestructura de tests/repositorios HHR. Rollback: revertir el PR.

### Syslab: recursos de cada caso bajo control (2026-10-02)

Toda la suite del transporte offscreen usa timers simulados por caso, también en
éxito, cancelación, navegación, límite de pendientes y error de postMessage.
Cada relay creado pertenece al caso y se dispone aun cuando falle una aserción.
Se comprueba que no queden timers; el timeout respeta su límite exacto de 250 ms
y una respuesta posterior no reenvía operaciones ni recupera trabajo vencido.
Se preservan los nueve escenarios y los filtros de origen, ventana y reqId.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.

### Popup: worker silencioso y respuestas tardías (2026-10-02)

La suite ejecuta el script real del estado del worker con reloj simulado por caso.
Conserva versión del manifest y respuestas de éxito, rechazo y excepción síncrona.
Añade un worker sin respuesta: sigue pendiente a 4999 ms, falla a 5000 ms, limpia
su timer y no vuelve a estar listo si llega tarde el contexto. También rechaza una
versión distinta o una generación ausente. El teardown comprueba cero timers.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.
No cambia el paquete de extensión ni sus plazos de respuesta.
