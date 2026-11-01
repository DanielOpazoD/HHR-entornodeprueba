# Reduccion Segura de Deuda Muerta V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir LOC y carga cognitiva del repo de forma gradual y reversible, priorizando activos no-productivos y compatibilidad legacy antes de tocar dominios clínicos o seams sensibles.

**Architecture:** Este V3 conserva la dirección del `v2`, pero añade una columna operativa más fuerte: contract tests antes de retirar bridges legacy, blast radius por PR, rollback tags por fase, uso explícito de guardrails propios del repo, y separación tajante entre poda técnica segura y poda condicionada por datos de producto. La estrategia sigue siendo subtractiva, nunca de reescritura.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Firebase 12.6, IndexedDB, TanStack Query 5.90, Vitest, Playwright, Netlify, guardrails `check:*`, reportes `report:*`, Husky/lint-staged.

---

## Qué mejora V3 sobre V2

1. Agrega contract tests obligatorios antes de retirar compatibilidad legacy.
2. Define blast radius por tipo de cambio y ajusta revisión/observación según riesgo.
3. Introduce rollback tags y handoff operativo como parte del plan, no como buena práctica opcional.
4. Pone `check:bundle-budget` y `check:chunk-graph` como validación ex-post cuando se toque `src/`.
5. Refuerza el uso de guardrails propios del repo antes de proponer herramientas externas.
6. Mantiene la lección dura de esta rama: no consolidar seams cruzando `hooks` y `features`.

## Estado actual de esta rama

Cambios ya ejecutados que cuentan como avance válido dentro de este V3:

- poda low-risk de `src/`:
  - `src/utils/publicCensusToken.ts`
  - `src/features/transfers/components/internal/TransferStatusBadge.tsx`
  - `src/features/admin/components/AITelemetryPanel.tsx`
  - `src/features/admin/components/AuditPagination.tsx`
  - `src/features/admin/components/CensusAccessManager.tsx`
- archivado histórico inicial:
  - `docs/*_PHASE3_README.md` movidos a `docs/archive/`
- consolidación parcial de tests:
  - removida la suite duplicada `src/tests/hooks/useCensusPromptState.test.ts`
- baseline reciente validado:
  - `npm run check:docs-drift`
  - `npm run typecheck`
  - `npm run check:quality`
  - tests focalizados del frente tocado

## Principios no negociables

- Subtraer antes que refactorizar.
- Evidencia del repo antes que intuición.
- Un dominio o un lote por PR.
- Boundaries sagrados: `check:shared-layer-boundary`, `check:folder-dependencies`, `check:barrel-boundaries`.
- Sin imports no implica sin uso: revisar Workers, imports dinámicos, Netlify, barrels, rutas por string.
- No tocar reglas clínicas ni flows críticos sin revisor humano adecuado.
- Tests son contrato; no se editan para acomodar limpiezas.
- Si un archivo tiene alto churn reciente, se estabiliza antes de tocarlo.

## Guardrails y reportes que mandan en este plan

Checks prioritarios:

- `npm run check:quality`
- `npm run check:docs-drift`
- `npm run check:repo-hygiene`
- `npm run check:module-size`
- `npm run check:hook-hotspots`
- `npm run check:hotspot-growth`
- `npm run check:compatibility-import-governance`
- `npm run check:bundle-budget`
- `npm run check:chunk-graph`

Reportes prioritarios:

- `npm run report:quality-metrics`
- `npm run report:maintenance-debt-scorecard`
- `npm run report:operational-health`
- `npm run report:compatibility-governance`

Gates por nivel:

- feedback rápido: `npm run ci:pre-merge`
- validación fuerte en cambios de `src/`: `npm run ci:merge-gate`
- validación de bundle/preview: `npm run ci:preview-gate`

## Framework de decisión por archivo o feature

Antes de tocar cualquier candidato:

1. ¿Tuvo bugfixes o churn alto en 90 días?
   Si sí, no entra como low-risk.
2. ¿Tiene tests?
   Si no, no se limpia hasta tener cobertura mínima.
3. ¿Está en censo, handoff, UPC, staffing o export clínico?
   Si sí, requiere revisión más dura.
4. ¿Hay wiring especial?
   Revisar `import()`, `new Worker(...)`, Netlify functions, barrels, strings de path.
5. ¿Cruza layers para “deduplicar”?
   Si sí, no hacerlo en la misma ola.

Herramientas externas sugerentes, no autoritativas:

- `npx knip`
- `npx ts-prune`
- `npx depcheck`
- `npx madge --orphans src`

Solo se usan para generar candidatos; la decisión final la toman los guardrails y la lectura del repo.

## Fase 1: Poda No-Productiva

**Riesgo:** cero  
**Objetivo:** reducir volumen y ruido fuera de `src/`, cerrando `docs/` y `scripts/` antes de tocar runtime o dominio.  
**Estado:** en progreso; docs históricas ya empezaron, `scripts/` todavía pendiente.

**Files:**

- Modify/Delete: `docs/**`
- Modify/Delete: `scripts/**`
- Inspect: `package.json`
- Inspect: `.github/workflows/**`
- Inspect: `.husky/**`
- Modify: `docs/archive/**`
- Create/Modify: `scripts/README.md`

- [ ] **Step 1: Completar poda de docs históricas**

Run:

```bash
find docs -maxdepth 2 -type f -name '*.md' | sort
rg -n --glob '!docs/api/**' 'ADR|RUNBOOK|README|TRACKER|EVALUATION|PHASE3' docs
npm run check:docs-drift
```

Target:

- `docs/MODULE_EVALUATION_*.md`
- `docs/MAINTAINABILITY_EXECUTION_BASELINE.md`
- `docs/QUARTERLY_MAINTENANCE_TRACKER.md`
- `docs/TECHNICAL_APPLICATION_AUDIT.md`
- `docs/EVALUATION_RUBRIC.md`

- [ ] **Step 2: Clasificar scripts por uso real**

Run:

```bash
rg -n 'scripts/' package.json .github/workflows .husky netlify.toml
git log --since='180 days ago' --name-only -- scripts | sort -u
find scripts -type f | sort
```

Categorías:

- A: CI/hooks/Netlify
- B: vigentes de uso manual
- C: no referenciados y sin actividad reciente
- D: one-shot/obsoletos

- [ ] **Step 3: Borrar scripts C y D en lotes pequeños**

Rule:

- máximo un cluster por commit
- si hay duda de uso, no borrar

- [ ] **Step 4: Documentar scripts B vigentes**

Output:

- `scripts/README.md` con scripts manuales aún válidos

- [ ] **Step 5: Gate de cierre**

Run:

```bash
npm run check:docs-drift
npm run check:repo-hygiene
npm run typecheck
npm run check:quality
npm run test:ci:unit
npm run ci:merge-gate
```

Done cuantitativo sugerido:

- `docs/` vivo <= 40 archivos
- `scripts/` <= 90 archivos

## Fase 2: Retiro de Bridges Legacy

**Riesgo:** bajo  
**Objetivo:** retirar compatibilidad legacy en storage solo después de probar comportamiento y auditar datos reales.

**Files:**

- Inspect/Modify: `src/services/storage/README.md`
- Inspect/Modify: `src/services/storage/migration/legacyFirestoreBridge.ts`
- Inspect/Modify: `scripts/**` para auditoría/migración

- [ ] **Step 1: Inventariar bridges y paths legacy**

Run:

```bash
sed -n '60,140p' src/services/storage/README.md
```

- [ ] **Step 2: Crear contract test antes de tocar código**

Objetivo del test:

- capturar el comportamiento observable del bridge actual
- permitir correr la misma expectativa contra el path canónico luego del retiro

- [ ] **Step 3: Auditar uso real de datos legacy**

Run:

```bash
npm run report:compatibility-governance
```

Y si hace falta:

- script one-shot para contar documentos por path y última actividad

- [ ] **Step 4: Retirar un bridge por PR**

Orden:

1. adapters legacy sin runtime activo
2. helpers de path/fallback
3. bridge principal al final

- [ ] **Step 5: Verificación reforzada**

Run:

```bash
npm run check:compatibility-import-governance
npm run typecheck
npm run check:quality
npm run test:ci:unit
```

Si toca storage/auth/runtime:

```bash
npm run test:rules:ci
```

- [ ] **Step 6: Post-deploy hold**

Rule:

- no seguir con el siguiente retiro hasta 48h con `report:operational-health` limpio

## Fase 3: Consolidación de Server State

**Riesgo:** medio  
**Objetivo:** concentrar server state en TanStack Query y reducir estado manual.

**Files:**

- Inspect/Modify: `src/context/**`
- Inspect/Modify: `src/hooks/**`
- Inspect/Modify: `src/features/**`
- Inspect: hooks query existentes

- [ ] **Step 1: Separar UI state de server state**

Run:

```bash
rg -n 'createContext|useContext|useReducer|useState' src/context src/hooks src/features
rg -n 'useQuery|queryClient|cancelQueries' src/context src/hooks src/features
```

- [ ] **Step 2: Migrar un feature por PR en orden crítico**

Orden fijo:

1. backup
2. historial / viewers
3. laboratory
4. admin / audit
5. handoff
6. census

- [ ] **Step 3: Protocolo por feature**

Para cada PR:

- inventario del estado manual
- mover datos remotos a `useQuery`
- reemplazar `refetch` manual por invalidación declarativa
- eliminar la capa manual equivalente
- no cruzar layers para unificar seams

- [ ] **Step 4: Verificación por feature**

Run:

```bash
npm run typecheck
npm run check:quality
npm run check:shared-layer-boundary
npm run check:folder-dependencies
npm run check:hook-hotspots
npx vitest run src/tests/features/<feature> src/tests/hooks/use<Feature>*
npm run ci:merge-gate
```

- [ ] **Step 5: Bundle check ex-post**

Run:

```bash
npm run check:bundle-budget
npm run check:chunk-graph
```

## Fase 4: Presupuesto de Código

**Riesgo:** cero  
**Objetivo:** evitar rebrote de tamaño usando los guardrails del repo.

**Files:**

- Modify: scripts/config y checks existentes
- Modify: guardrails de tamaño/hotspots

- [ ] **Step 1: Endurecer infra existente, no sumar lint genérico**

Prioridad:

- `check:module-size`
- `check:handoff-module-size`
- `check:census-module-size`
- `check:transfers-module-size`
- `check:hook-hotspots`
- `check:hotspot-growth`

- [ ] **Step 2: Rollout progresivo**

Orden:

1. report-only
2. warning
3. bloqueante en archivos nuevos
4. bloqueante global

- [ ] **Step 3: Validar también por bundle**

Run después de tocar `src/`:

```bash
npm run check:bundle-budget
npm run check:chunk-graph
```

## Fase 5: Poda de Features

**Riesgo:** alto  
**Objetivo:** reducir `src/` con decisión de producto y feature flag, no por intuición.

**Files:**

- Inspect: features candidatas
- Modify: instrumentación/analytics si falta

- [ ] **Step 1: No borrar sin datos**

Candidatos solo para evaluación:

- exportadores marginales
- dashboards de admin con uso bajo
- integraciones poco usadas

Excluidos como low-risk:

- FHIR
- terminology

- [ ] **Step 2: Instrumentar uso por feature y rol**

Ventana mínima:

- 60 días

- [ ] **Step 3: Feature flag sombra antes del delete**

Protocolo:

1. 30 días flag `true`
2. 30 días flag `false`
3. si no hay reclamos, borrar

## Blast Radius por PR

Clasificación sugerida:

- NULO: docs o scripts sin efecto runtime
- BAJO: bridges o lecturas auxiliares con rollback fácil
- MEDIO: migración de feature de lectura o admin
- ALTO: census, handoff, cualquier cambio con impacto clínico directo

Política:

- NULO: `ci:pre-merge` basta
- BAJO: `ci:merge-gate` + 48h observación
- MEDIO: `ci:merge-gate` + test/e2e específico + 2 revisores si aplica
- ALTO: revisor clínico + 72h observación + rollback documentado

## Rollback Plan

Convención de tags:

```bash
git tag pre-fase-1-lote-<N>
git tag pre-legacy-retire-<N>
git tag pre-state-migration-<feature>
git tag pre-remove-<feature>
```

Recuperación:

```bash
git restore --source=<tag> path/
git checkout -b rollback-<tag> <tag>
```

## Handoff obligatorio al siguiente agente

Al cerrar una ola, dejar:

- fase y fecha
- commits/PRs relevantes
- tags creados
- checks ejecutados
- LOC netas removidas
- decisiones tomadas y por qué
- bloqueos encontrados
- siguiente paso concreto

Ruta sugerida:

- `reports/handoff-YYYY-MM-DD.md`

## Prioridad real desde donde estamos hoy

1. terminar Fase 1 en `scripts/`
2. seguir archivando docs históricas de baja encontrabilidad
3. consolidar 1 o 2 pares adicionales de tests duplicados sin cruzar layers
4. dejar FHIR y terminology fuera de la ola low-risk

## Señales para frenar o abortar

- suben bugfixes de sync/bootstrap/loaders
- `ci:merge-gate` se degrada de forma visible
- aparecen alertas nuevas en `report:operational-health`
- se requiere cruzar layers para “completar” una limpieza
- cae confianza clínica o aparecen regresiones en censo/handoff/export
