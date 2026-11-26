# Roadmap de Bloques de Auditoria

Fecha base: 2026-04-20  
Objetivo: ejecutar mejoras de alto valor derivadas de la auditoría técnica sin sobreingeniería ni reescrituras.

## Estado actual

- Bloque actual en curso: `Bloque 8: Shell autenticado y composicion`
- Siguiente bloque acordado después de este: `Bloque 9: Superficies compartidas de alta importacion`

## Bloques

### Bloque 1: Arquitectura Ejecutable y Estabilidad Base

Estado: `completado`

Resultado:

- se eliminaron barrels puente en `application`
- se rompieron ciclos en `census`, `cudyr` y `backup-export`
- `application` dejó de depender de `hooks/controllers`
- se encapsuló el runtime state de sync
- `check:quality`, `typecheck` y `check:bundle-budget` quedaron verdes

Validación ejecutada:

- `npm run typecheck`
- `npm run check:quality`
- `npm run check:bundle-budget`
- Vitest dirigido del bloque

### Bloque 2: Seguridad y Control de Privilegios

Estado: `completado`

Resultado:

- se retiró la allowlist hard-coded de bootstrap admin de `firestore.rules`
- se retiró la allowlist hard-coded de `storage.rules`
- `functions/lib/auth/*`, `netlify/functions/lib/firebase-auth.ts` y `src/services/auth/*` dejaron de depender de correos embebidos
- `setUserRole` quedó restringido a claim admin real
- la documentación canónica de acceso y runbooks se actualizaron al modelo sin bypass
- el harness/tests de reglas se ajustaron al modelo canónico con `config/roles`

Validación ejecutada:

- `npm run typecheck`
- `npm run check:security`
- `npm run check:quality`
- `npx vitest run src/tests/security/rulesHardeningStatic.test.ts src/tests/functions/authCallablePolicy.test.ts src/tests/functions/authHelpersFactory.test.ts src/tests/functions/authFunctionsFactory.test.ts src/tests/services/auth/authRoleLookup.test.ts src/tests/services/auth/authRoleResolutionController.test.ts src/tests/services/authService.test.ts src/tests/netlify/firebaseAuth.test.ts`
- `bash scripts/run-firestore-rules-ci.sh`

Riesgo residual aceptado:

- siguen existiendo referencias históricas al bootstrap admin en documentos de auditoría/iteración previos; se conservan como registro histórico, no como contrato vigente

### Bloque 3: Cobertura Crítica y Confianza Operativa

Estado: `completado`

Resultado:

- se corrigieron bloqueos de suite que impedían medir cobertura real en `authFlowRuntime`, `census-export` y `useExportManager`
- se añadieron tests directos para `useClinicalDocumentIndicationsCatalog`, `useClinicalDocumentSheetState` y `useClinicalDocumentDraftRemoteSync`
- `src/features/clinical-documents` pasó de quedar bajo baseline a superar el gate crítico
- `reports/critical-coverage.md` quedó en `passing`
- `reports/operational-health.md` quedó con `Critical Coverage` en `passing`

Validación ejecutada:

- `npx vitest run src/tests/services/auth/authFlowRuntime.test.ts`
- `npx vitest run src/tests/integration/census-export.test.ts`
- `npx vitest run src/tests/hooks/useExportManager.test.ts src/tests/features/clinical-documents/useClinicalDocumentIndicationsCatalog.test.ts src/tests/features/clinical-documents/useClinicalDocumentSheetState.test.ts src/tests/features/clinical-documents/useClinicalDocumentDraftRemoteSync.test.ts`
- `npm run check:critical-coverage`
- `node scripts/report-critical-coverage.mjs`
- `node scripts/report-operational-health.mjs`
- `node scripts/report-system-confidence.mjs`

Riesgo residual aceptado:

- `system-confidence` sigue `degraded` por worktree sucio durante la ejecución, no por fallas abiertas ni por cobertura crítica

### Bloque 4: Mantenibilidad de Reglas y Runtime Sensible

Estado: `completado`

Objetivo:

- modularizar y volver más auditables `firestore.rules` y runtime sensible relacionado
- reducir costo de cambio sin alterar el modelo de acceso ya endurecido

Resultado:

- `firestore.rules` y `storage.rules` quedaron divididos en fuentes editables bajo `rules/`
- se añadió generación determinista de outputs raíz mediante `scripts/build-rules-assets.mjs`
- se añadió detección de drift mediante `scripts/check-rules-generated.mjs`
- `check:security` y los tests con emulador ahora fuerzan sincronización previa de reglas generadas
- el costo de revisar cambios en reglas baja sin cambiar el contrato que Firebase y el emulador esperan

Validación ejecutada:

- `npm run typecheck`
- `npm run check:security`
- `bash scripts/run-firestore-rules-ci.sh`

Riesgo residual aceptado:

- la modularización actual es por fragmentos concatenados; mejora auditabilidad y gobernanza, pero no reduce aún complejidad semántica interna de cada helper

### Bloque 5: Escalabilidad Técnica y Performance

Estado: `completado`

Objetivo:

- atacar hotspots de churn y deuda de performance sin abrir refactors masivos

Resultado:

- `useCensusEmailRecipientLists` dejó de mezclar orquestación con persistencia duplicada de settings
- la persistencia de destinatarios y lista activa quedó centralizada en `useCensusEmailRecipientPersistenceEffect`
- el hotspot principal de hooks bajó de `244` a `226` líneas en el scorecard actualizado
- `check:bundle-budget` confirmó que `app-authenticated-shell` sigue bajo presupuesto (`491.5 KB / 546.9 KB`)
- el scorecard de release ya no muestra deuda activa de bundle ni hotspots de chunk por encima del umbral

Validación ejecutada:

- `npx vitest run src/tests/hooks/useCensusEmailRecipientPersistenceEffect.test.tsx src/tests/hooks/useCensusEmail.test.ts`
- `npm run typecheck`
- `npm run check:quality`
- `npm run check:bundle-budget`
- `npm run report:maintenance-debt-scorecard`
- `npm run report:flow-performance-budget`
- `npm run report:release-readiness-scorecard`

Riesgo residual aceptado:

- `reports/system-confidence.md` y `reports/release-readiness-scorecard.md` siguen marcando `dirty worktree` porque fueron regenerados antes del commit de cierre; el degraded restante es de snapshot, no de guardrails fallando

### Bloque 6: Documentación y Operación

Estado: `completado`

Objetivo:

- depurar documentación duplicada y consolidar runbooks finales después de cerrar lo estructural, de seguridad y de cobertura

Resultado:

- se creó `docs/RUNBOOK_INDEX.md` como puerta de entrada operativa única por escenario
- `docs/DOCUMENTATION_MAP.md` quedó alineado con el índice de runbooks, `rules/README.md` y los documentos de trabajo en `docs/superpowers/*`
- `docs/DEVELOPER_COMMANDS.md` ya incluye la superficie útil para reglas generadas, docs y snapshots de gobernanza
- `docs/CI_GATES_AND_FAILURE_RUNBOOKS.md` quedó enlazado al nuevo índice operativo para reducir navegación redundante
- `README.md` ahora expone el índice operativo y el mapa documental desde la entrada principal del repo

Validación ejecutada:

- `npx prettier --check README.md docs/RUNBOOK_INDEX.md docs/DOCUMENTATION_MAP.md docs/DEVELOPER_COMMANDS.md docs/CI_GATES_AND_FAILURE_RUNBOOKS.md`
- `npm run check:docs-drift`
- `npm run check:operational-runbooks`

Riesgo residual aceptado:

- la depuración fue de entrypoints e indexación; no se reescribieron runbooks largos ni se eliminó documentación histórica que todavía sirve como registro de trabajo

### Bloque 7: Startup UX y Release Confidence

Estado: `completado`

Objetivo:

- llevar `frontend_startup` desde `degraded` a `ok`
- convertir el comportamiento actual de refresh autenticado por módulo en contrato visible y de release
- evitar regresiones en login, census y chrome por ruta sin reintroducir loaders globales

Por qué sube la nota global:

- mejora directamente `UX de arranque y refresh`
- mejora `confianza real de release`
- consolida una de las zonas que más sensibilidad mostró frente a cambios chicos

Scope acotado:

- `index.html`
- `src/index.tsx`
- `src/App.tsx`
- `src/app-shell/bootstrap/*`
- `src/tests/app-shell/*`
- `src/tests/components/AppLoadingBehavior.test.tsx`
- `src/tests/security/startupPrebootContractStatic.test.ts`

Trabajo esperado:

- convertir el fix route-aware actual en contrato de release explícito
- añadir verificación de preview/refresh autenticado por módulo si falta cobertura real
- regenerar snapshots de gobernanza para que `system-confidence` y `release-readiness` dejen de arrastrar estado viejo

Resultado:

- el smoke real de preview `test:e2e:preview:census-bootstrap` quedó verde con `3 passed`
- `reports/e2e/preview-bootstrap/report.json` volvió a reflejar un bootstrap válido (`expected=3`, `unexpected=0`)
- `reports/system-confidence.md` quedó en `Overall status: ok`
- `reports/release-readiness-scorecard.md` quedó en `Overall: ok`
- `frontend_startup` dejó de estar degradado y pasó a `status=ok, preview=ok, issues=0`

Validación esperada:

- `npm run report:governance-snapshots`
- `npx vitest run src/tests/app-shell/BootstrapRouteChrome.test.tsx src/tests/app-shell/appShellLoadingPolicy.test.ts src/tests/components/AppLoadingBehavior.test.tsx src/tests/components/index.bootstrap.test.tsx src/tests/security/startupPrebootContractStatic.test.ts`
- `npm run typecheck`
- `npm run lint -- --max-warnings 0`

Validación ejecutada:

- `npm run test:e2e:preview:census-bootstrap`
- `npm run report:governance-snapshots`

Criterio de cierre:

- `reports/system-confidence.md` sin `frontend_startup: degraded`
- refresh autenticado estable en las rutas críticas sin flashes ni shells incorrectos

Riesgo residual aceptado:

- no se buscará un sistema de preload más ambicioso ni una nueva superficie visual; solo consolidar el contrato actual

### Bloque 8: Shell autenticado y composición

Estado: `completado`

Objetivo:

- seguir reduciendo fan-out y duplicidad en el shell autenticado
- dejar `AppContent`, `AppContentChrome`, `AppContentOverlays`, `AppRouter` y `useAppState` más declarativos

Por qué sube la nota global:

- mejora `mantenibilidad`
- mejora `capacidad de evolucionar sin romper`
- reduce costo mental en la zona de más uso diario

Scope acotado:

- `src/components/layout/AppContent.tsx`
- `src/components/layout/app-content/AppContentChrome.tsx`
- `src/components/layout/app-content/AppContentOverlays.tsx`
- `src/components/AppRouter.tsx`
- `src/components/app-router/*`
- `src/hooks/useAppState.ts`
- tests focalizados de shell/router

Trabajo esperado:

- extraer builders chicos de props/handlers de `Navbar` y `DateStrip`
- podar props redundantes entre shell y router
- seguir concentrando decisiones puras en controllers chicos ya existentes

Resultado:

- se retiró el armado inline de props del router desde `AppContentChrome`
- se agrupó el contrato `Chrome -> AppRouter` en `AppRouterShellState`
- `buildAppRouterShellState` quedó como builder testeado junto a `buildNavbarProps` y `buildDateStripProps`
- `AppRouter` dejó de exponer 8 props sueltas de shell y consume un contrato único derivado por la composición autenticada

Validación esperada:

- `npx vitest run src/tests/components/AppContent*.test.tsx src/tests/components/AppRouter.test.tsx`
- `npm run typecheck`
- `npm run lint -- --max-warnings 0`

Validación ejecutada:

- `npx vitest run src/tests/components/AppContent*.test.tsx src/tests/components/appContentChromeController.test.ts src/tests/components/AppRouter.test.tsx`

Criterio de cierre:

- `AppContentChrome` deja de mezclar composición con demasiado armado inline
- el shell autenticado baja fragilidad sin cambiar UX

Riesgo residual aceptado:

- no se va a reescribir el shell entero ni se moverán piezas estables solo por “limpieza”

### Bloque 9: Superficies compartidas de alta importación

Estado: `pendiente`

Objetivo:

- atacar 2-3 hotspots compartidos con mucho inbound import y costo de cambio
- priorizar contratos y helpers sobre refactors grandes

Por qué sube la nota global:

- mejora `robustez técnica`
- mejora `mantenibilidad`
- baja riesgo sistémico en superficies muy reutilizadas

Scope acotado:

- `src/components/shared/BaseModal.tsx`
- `src/context/AuthContext.tsx`
- `src/shared/runtime/browserWindowRuntimeCore.ts`
- `src/services/observability/operationalTelemetryOutcomeRecorder.ts`

Trabajo esperado:

- separar contratos/helpers donde la API pública sea demasiado amplia
- estabilizar seams de runtime/telemetría y focos de test frágil
- reducir branching implícito en componentes/shared contexts críticos

Validación esperada:

- vitest dirigido por superficie tocada
- `npm run typecheck`
- `npm run lint -- --max-warnings 0`
- si toca gobernanza, `npm run report:governance-snapshots`

Criterio de cierre:

- menos regresiones de seam en tests
- menos necesidad de mocks frágiles en superficies compartidas

Riesgo residual aceptado:

- no se tocarán tipos transversales de dominio si el retorno inmediato no es claro

### Bloque 10: Pulido UX de alto tráfico

Estado: `pendiente`

Objetivo:

- subir calidad percibida del producto en superficies de uso diario sin rediseño masivo

Por qué sube la nota global:

- mejora `UX diaria`
- mejora `calidad percibida de producto`
- ayuda a que la app se sienta más cerrada y premium

Scope acotado:

- `Navbar`
- `DateStrip`
- acciones principales de census/handoffs/traslados
- continuidad visual entre estados de uso frecuente

Trabajo esperado:

- pulido de spacing, estados, jerarquía y continuidad
- consistencia de feedback en acciones críticas
- pequeñas correcciones visibles con alto retorno diario

Validación esperada:

- tests existentes afectados
- `npm run typecheck`
- `npm run lint -- --max-warnings 0`
- validación visual local en los módulos de mayor uso

Criterio de cierre:

- menos asperezas visibles en navegación, fecha y acciones
- mejor percepción de velocidad y continuidad

Riesgo residual aceptado:

- no se abrirá una nueva línea de diseño ni un rediseño completo del sistema visual

### Bloque 11: Cierre de score y gobernanza viva

Estado: `pendiente`

Objetivo:

- medir el efecto real de los bloques anteriores y dejar la nueva nota sustentada en evidencia del repo

Por qué sube la nota global:

- consolida `testing y gobernanza`
- convierte mejoras locales en confianza acumulada

Scope acotado:

- `reports/*`
- scorecards de release/confianza/cobertura
- documentación corta de contratos nuevos que hayan quedado vigentes

Trabajo esperado:

- regenerar reportes clave al final del batch
- actualizar este roadmap con estado real por bloque
- dejar trazabilidad de qué subió la nota y por qué

Validación esperada:

- `npm run report:governance-snapshots`
- `npm run check:quality`
- `npm run typecheck`
- `npm run lint -- --max-warnings 0`

Criterio de cierre:

- scorecards alineados con HEAD
- roadmap actualizado y ejecutable para el siguiente tramo

Riesgo residual aceptado:

- la reevaluación no reemplaza validación visual real de UX crítica; la complementa
