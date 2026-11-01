# Reduccion Segura de Deuda Muerta V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir tamaño y carga cognitiva del repo sin degradar flujos clínicos, tests, boundaries ni confianza operativa.

**Architecture:** El plan se reorganiza en 5 fases de menor a mayor riesgo: activos no-productivos, compatibilidad legacy, consolidación de server state, presupuesto de código y poda de features. La ejecución sigue siendo incremental, pero ahora con una separación más estricta entre poda técnica segura y decisiones que requieren validación de producto.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Firebase 12.6, IndexedDB, Vitest, Playwright, Netlify, guardrails `check:*`, reportes `report:*`, Husky/lint-staged.

---

## Qué mejora respecto al plan anterior

1. Prioriza antes `docs/` y `scripts/`, que es donde está el mayor ahorro sin tocar `src/`.
2. Baja de prioridad los candidatos ambiguos de `src/` como FHIR y terminology: ya no cuentan como limpieza low-risk.
3. Endurece salvaguardas para no repetir el problema que vimos al intentar consolidar `useCensusPromptState` cruzando layers.
4. Introduce una fase explícita de compatibilidad legacy con auditoría de datos antes de borrar bridges.
5. Separa “poda técnica” de “poda por uso de producto”; esta última no debe ejecutarse solo por intuición.

## Estado actual de esta rama

Cambios ya hechos y compatibles con este plan:

- eliminados seams sin uso evidente:
  - `src/utils/publicCensusToken.ts`
  - `src/features/transfers/components/internal/TransferStatusBadge.tsx`
  - `src/features/admin/components/AITelemetryPanel.tsx`
  - `src/features/admin/components/AuditPagination.tsx`
  - `src/features/admin/components/CensusAccessManager.tsx`
- archivados los `docs/*_PHASE3_README.md` sin enlaces activos en `docs/archive/`
- retirada una suite de test duplicada de `useCensusPromptState`
- baseline operativo sigue verde:
  - `npm run check:docs-drift`
  - `npm run typecheck`
  - `npm run check:quality`
  - tests focalizados del frente tocado

Esto significa que la Fase 1 ya comenzó, pero todavía no está cerrada a nivel de `scripts/`.

## Criterios de éxito

- `npm run typecheck` verde
- `npm run check:quality` verde
- `npm run test:ci:unit` verde
- `npm run ci:merge-gate` verde al cierre de cada fase mayor
- `reports/quality-metrics.md` sin regresiones
- `reports/maintenance-debt-scorecard.md` con watchlist igual o menor
- `vitest.rules.config.ts` o su comando equivalente verde cuando se toque legacy/storage/rules
- sin cambios funcionales en flujos clínicos críticos: censo, handoff, export Excel/PDF, UPC, staffing

## Salvaguardas duras

- No reescribir módulos “para simplificar”.
- No tocar reglas clínicas sin validación explícita.
- No borrar bridges legacy sin auditar uso real de datos.
- No asumir que “sin imports” significa “sin uso”; revisar Netlify, `new Worker(...)`, imports dinámicos y barrels.
- No mezclar una poda de repo con features nuevas.
- No modificar tests para acomodar un cambio malo.
- No consolidar seams entre layers si rompe `shared-layer-boundary`, `folder-dependencies` o `repo-hygiene`.

## Fase 1: Poda de Activos No-Productivos

**Objetivo:** Reducir carga cognitiva y volumen fuera de `src/` antes de tocar dominio o runtime.

**Files:**

- Modify/Delete: `docs/**`
- Modify/Delete: `scripts/**`
- Inspect: `package.json`
- Inspect: `.github/workflows/**`
- Inspect: `.husky/**`
- Create/Modify: `docs/archive/**`

- [ ] **Step 1: Cerrar docs históricas restantes**

Run:

```bash
find docs -maxdepth 1 -type f | sort
rg -n --glob '!docs/api/**' "README|RUNBOOK|ADR|TRACKER|EVALUATION|PHASE3" docs
```

Expected:

- listado claro de documentos vivos vs históricos

- [ ] **Step 2: Archivar más documentos de baja encontrabilidad**

Candidatos inmediatos:

- `docs/MODULE_EVALUATION_*.md`
- `docs/MAINTAINABILITY_EXECUTION_BASELINE.md`
- `docs/QUARTERLY_MAINTENANCE_TRACKER.md`
- `docs/TECHNICAL_APPLICATION_AUDIT.md`
- `docs/EVALUATION_RUBRIC.md`

Rule:

- mover a `docs/archive/` en lotes pequeños
- no tocar ADRs, runbooks activos ni READMEs vivos

- [ ] **Step 3: Auditar scripts realmente usados**

Run:

```bash
rg -n "scripts/" package.json .github/workflows .husky
git log --since="90 days ago" --name-only -- scripts
find scripts -type f | sort
```

Expected:

- clasificación en `scripts/` de:
  - usados por CI
  - usados por hooks locales
  - usados manualmente pero vigentes
  - one-shot / obsoletos

- [ ] **Step 4: Borrar scripts one-shot en clusters chicos**

Rule:

- nunca más de un cluster por commit
- si un script no aparece en CI, hooks o git reciente, sigue siendo candidato; no es prueba absoluta de borrado

- [ ] **Step 5: Verificar la fase**

Run:

```bash
npm run check:docs-drift
npm run typecheck
npm run check:quality
npm run test:ci:unit
npm run ci:merge-gate
```

Expected:

- todo verde

## Fase 2: Cierre de Compatibilidad Legacy

**Objetivo:** Reducir casos mentales de compatibilidad histórica en storage/migration solo después de auditar uso real.

**Files:**

- Inspect/Modify: `src/services/storage/README.md`
- Inspect/Modify: `src/services/storage/migration/legacyFirestoreBridge.ts`
- Test: `src/tests/integration/**`
- Test: `vitest.rules.config.ts`

- [ ] **Step 1: Inventariar paths legacy y callers reales**

Run:

```bash
sed -n '60,140p' src/services/storage/README.md
```

Expected:

- lista concreta de bridges y paths legacy todavía soportados

- [ ] **Step 2: Crear auditoría de uso real antes de borrar**

Output esperado:

- script idempotente bajo `scripts/` que:
  - enumere paths legacy
  - mida volumen
  - capture última escritura o evidencia equivalente

Rule:

- si hay uso activo, no borrar bridge todavía

- [ ] **Step 3: Si el audit sale limpio, retirar un bridge por PR**

Orden sugerido:

1. adapters no usados
2. helpers de path o fallback
3. bridge principal solo al final

- [ ] **Step 4: Verificación reforzada**

Run:

```bash
npm run typecheck
npm run check:quality
npm run test:ci:unit
npx vitest run src/tests/integration
```

Y además:

- tests de rules/storage si el cambio toca ese perímetro

- [ ] **Step 5: Post-deploy hold**

Regla operativa:

- no continuar al siguiente borrado legacy hasta pasar una ventana de observación y telemetría sin alertas de lectura/escritura

## Fase 3: Consolidación de Server State

**Objetivo:** Reducir duplicación de loading/error/refetch manual y contexts que hoy transportan server state.

**Files:**

- Inspect/Modify: `src/hooks/**`
- Inspect/Modify: `src/context/**`
- Inspect/Modify: `src/features/**`
- Inspect/Modify: hooks Query existentes (`useDailyRecordQuery`, `useBackupFilesQuery`, `useExistingDaysQuery`)

- [ ] **Step 1: Inventariar contexts que cargan datos remotos**

Run:

```bash
rg -n "createContext|useContext|useReducer|useState" src/context src/hooks src/features
rg -n "useQuery|queryClient|cancelQueries" src/hooks src/features
```

Expected:

- separar:
  - UI state puro
  - server state disfrazado de context/hook manual

- [ ] **Step 2: Elegir un feature de bajo acoplamiento**

Orden recomendado:

1. backup
2. historial / viewers aislados
3. laboratory
4. census/handoff al final

- [ ] **Step 3: Migrar un feature por PR**

Rule:

- cada PR debe:
  - introducir `useQuery`/invalidación declarativa
  - retirar la capa manual equivalente
  - mantener API pública o ajustar consumers del mismo bounded context

- [ ] **Step 4: No cruzar layers para “deduplicar”**

Aprendizaje de esta rama:

- si un seam existe en `src/hooks` y también en `src/features`, no consolidarlo forzando un import desde `hooks` hacia `features`
- primero abrir una API pública aprobada o aceptar la duplicación temporal

- [ ] **Step 5: Verificación**

Run:

```bash
npm run typecheck
npm run check:quality
npx vitest run src/tests/<feature>
npm run ci:merge-gate
```

## Fase 4: Presupuesto de Código

**Objetivo:** Evitar que el repo vuelva a crecer sin control después de la poda.

**Files:**

- Modify: configuración de lint o checks equivalentes
- Modify: scripts de guardrails existentes si conviene aprovechar infraestructura actual

- [ ] **Step 1: Preferir guardrails existentes antes que sumar ESLint genérico**

Regla:

- este repo ya tiene `check:module-size`, `check:hook-hotspots`, `check:hotspot-growth`
- ampliar esos scripts suele ser menos disruptivo que introducir reglas nuevas de golpe

- [ ] **Step 2: Probar rollout progresivo**

Orden:

1. report-only
2. warning visible
3. bloqueo en archivos nuevos
4. bloqueo global

- [ ] **Step 3: Medir sobre métricas reales**

Éxito:

- baja la cantidad de hotspots
- no suben los falsos positivos
- no se incentivan “splits” artificiales sin valor de dominio

## Fase 5: Poda de Features

**Objetivo:** Reducir LOC de `src/` de manera material solo donde producto confirme bajo uso.

**Files:**

- Inspect: dashboards, exporters, integraciones externas, features experimentales
- Modify: analytics/telemetry si falta instrumentación

- [ ] **Step 1: No borrar features sin datos de uso**

Candidatos solo para evaluación, no para borrado inmediato:

- FHIR
- exportadores marginales
- dashboards poco usados
- integraciones externas con adopción baja

- [ ] **Step 2: Instrumentar uso por feature y por rol**

Ventana mínima:

- 60 días

- [ ] **Step 3: Aplicar decisión de producto**

Matriz:

- uso alto: mantener
- uso medio: lazy-load
- uso muy bajo: extraer o borrar

## Prioridad real para esta rama

1. terminar Fase 1 en `scripts/` y docs históricas restantes
2. consolidar 1 o 2 pares de tests duplicados más, sin cruzar layers
3. dejar FHIR/terminology fuera de la ola low-risk

## Señales para frenar

- suben bugs de sync/bootstrap/loaders
- `ci:merge-gate` se vuelve más lento o inestable
- aparece necesidad de tocar tests para “acomodar” cambios
- se toca una zona clínica crítica solo por ganar LOC

## Resultado esperado si seguimos este V2

- mejor reducción fuera de `src/` en el corto plazo
- menos riesgo de limpieza cosmética en `src/`
- un camino más honesto para el ahorro estructural real: legacy + server state + decisiones de producto
