# Reduccion Segura de Deuda Muerta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir de forma segura codigo muerto, documentacion desactualizada, modulos sin uso y tests duplicados o innecesarios sin degradar cobertura, boundaries ni estabilidad operativa.

**Architecture:** El trabajo se divide en cinco olas pequenas: baseline, inventario, limpieza de bajo riesgo, consolidacion de tests y cierre documental. Cada ola usa evidencia antes de borrar, cambios pequenos por bounded context y verificacion completa despues de cada lote.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Playwright, Netlify, scripts `check:*` y `report:*`.

---

## Scope

Este plan NO propone una “gran poda” en una sola pasada. La estrategia correcta para este repo es:

1. medir primero,
2. borrar solo lo que tenga evidencia de no uso,
3. cerrar cada lote con checks verdes,
4. actualizar docs solo cuando el codigo ya convergio.

## Success Criteria

- `npm run typecheck` verde
- `npm run check:quality` verde
- `npm run test:ci:unit` verde
- `reports/quality-metrics.md` sin regresiones
- `reports/maintenance-debt-scorecard.md` con watchlist igual o menor
- ninguna eliminacion sin evidencia local de no uso

## Risk Rules

- No borrar modulos usados por imports dinamicos, rutas, barrels o wiring de Netlify sin prueba de no uso.
- No borrar tests por “parecer repetidos” antes de demostrar que cubren el mismo comportamiento.
- No reescribir documentacion masivamente; solo actualizar o archivar lo que tenga drift comprobado.
- No mezclar poda de codigo con refactors funcionales grandes.

## File Map

**Primary reports and guides**

- Modify: `reports/maintenance-debt-scorecard.md`
- Modify: `reports/quality-metrics.md`
- Modify: `docs/DEVELOPER_COMMANDS.md`
- Modify: `docs/FOUNDATION_CONTINUATION_TRACKER.md`
- Modify: `docs/TECHNICAL_DEBT_REGISTER.md`

**Likely cleanup targets**

- Inspect: `src/features/**`
- Inspect: `src/hooks/**`
- Inspect: `src/services/**`
- Inspect: `src/tests/**`
- Inspect: `docs/**`

**Possible supporting outputs**

- Create: `docs/superpowers/plans/cleanup-inventory-*.md`
- Create: `reports/dead-code-inventory.json` if a temporary machine-readable inventory is useful

---

### Task 1: Baseline And Guardrails

**Files:**

- Modify: `reports/maintenance-debt-scorecard.md`
- Modify: `reports/quality-metrics.md`

- [ ] **Step 1: Refresh baseline reports**

Run:

```bash
npm run report:maintenance-debt-scorecard
npm run report:quality-metrics
```

Expected:

- both commands succeed
- current hotspot/watchlist snapshot reflects `HEAD`

- [ ] **Step 2: Capture current safety baseline**

Run:

```bash
npm run typecheck
npm run check:quality
npm run test:ci:unit
```

Expected:

- all commands exit `0`

- [ ] **Step 3: Commit the baseline snapshot if reports changed**

```bash
git add reports/maintenance-debt-scorecard.* reports/quality-metrics.*
git commit -m "Refresh cleanup baseline reports"
```

---

### Task 2: Build A Dead-Code Inventory Before Deleting Anything

**Files:**

- Inspect: `src/features/**`
- Inspect: `src/hooks/**`
- Inspect: `src/services/**`
- Inspect: `src/tests/**`
- Create: `docs/archive/superpowers/plans/cleanup-inventory-2026-04-19.md`

- [ ] **Step 1: Inventory apparently unused modules**

Run:

```bash
rg --files src docs
rg -n "export |import\(" src
```

Review for:

- files with no static imports
- files referenced only by historical docs
- controllers/helpers no longer reachable from public entrypoints

- [ ] **Step 2: Inventory outdated documentation**

Run:

```bash
npm run check:docs-drift
rg -n "TODO|deprecated|legacy|obsolete|no usar|old flow" docs src/README.md src/features src/services
```

Expected:

- clear list of docs that mismatch current architecture or commands

- [ ] **Step 3: Inventory duplicated or weak-value tests**

Run:

```bash
rg -n "describe\\(|it\\(" src/tests
rg -n "same setup marker" src/tests
```

Manual classification:

- exact duplicate behavior assertions
- same seam tested in unit and integration with no additional risk coverage
- brittle tests covering implementation details instead of behavior

- [ ] **Step 4: Save the inventory before any cleanup**

Document:

- candidate file
- evidence of no use / duplication
- risk level: low, medium, high
- required verification command

---

### Task 3: Low-Risk Cleanup Wave

**Files:**

- Modify/Delete: files classified as `low risk` in the inventory
- Test: nearest feature or service suite

- [ ] **Step 1: Remove only one low-risk cluster at a time**

Good first candidates:

- stale docs that reference removed flows
- tiny helper/controller files with no inbound references
- test fixtures left after prior refactors

- [ ] **Step 2: Verify each cluster immediately**

Run one focused test command per cluster, plus:

```bash
npm run typecheck
npm run check:quality
```

- [ ] **Step 3: Commit each cluster separately**

```bash
git add <paths>
git commit -m "Remove unused <cluster-name>"
```

Rule:

- never bundle unrelated deletions in the same commit

---

### Task 4: Duplicate-Test Consolidation Wave

**Files:**

- Modify: `src/tests/**`
- Modify/Create: shared test helpers near duplicated suites

- [ ] **Step 1: Pick only duplicate tests with proven overlap**

Allowed candidates:

- identical setup repeated across many suites
- repeated assertions for the same controller contract
- duplicated fixture builders that obscure intent

Not allowed:

- removing an integration test only because a unit test exists
- removing a regression test without mapping the bug it protects

- [ ] **Step 2: Write/adjust the guard test first when removing duplication**

Approach:

- keep one strongest behavior test
- extract shared setup helper
- delete only the lower-signal duplicate

- [ ] **Step 3: Run only the affected suites first**

Example:

```bash
npx vitest run src/tests/<affected-suite-a>.test.ts src/tests/<affected-suite-b>.test.ts
```

- [ ] **Step 4: Run global safety checks**

```bash
npm run test:ci:unit
npm run check:quality
```

- [ ] **Step 5: Commit**

```bash
git add src/tests
git commit -m "Consolidate duplicated test coverage in <area>"
```

---

### Task 5: Medium-Risk Cleanup Wave

**Files:**

- Modify/Delete: medium-risk modules from inventory
- Modify: barrels or public entrypoints if they still export dead code

- [ ] **Step 1: Tackle one bounded context at a time**

Order recommendation:

1. `src/features/laboratory`
2. `src/services/repositories`
3. `src/features/handoff`
4. `src/hooks`

- [ ] **Step 2: For each candidate, prove no runtime reachability**

Check:

- direct imports
- dynamic imports
- barrel exports
- route/module maps
- string-based references in docs/tests/scripts

Commands:

```bash
rg -n "<symbol-or-file-name>" src tests docs scripts
```

- [ ] **Step 3: Delete and verify bounded context locally**

Run:

```bash
npx vitest run src/tests/<context>
npm run typecheck
npm run check:quality
```

- [ ] **Step 4: Commit each bounded-context cleanup**

```bash
git add <paths>
git commit -m "Prune unused <bounded-context> modules"
```

---

### Task 6: Documentation Convergence Wave

**Files:**

- Modify: `README.md`
- Modify: `docs/**`
- Modify: `docs/TECHNICAL_DEBT_REGISTER.md`
- Modify: `docs/FOUNDATION_CONTINUATION_TRACKER.md`

- [ ] **Step 1: Update docs only for changes already merged in cleanup commits**

Never update docs “in advance”.

- [ ] **Step 2: Archive or remove stale docs with no current owner**

Decision rule:

- update if still relevant
- archive if historically useful
- delete if wrong and low-value

- [ ] **Step 3: Re-run doc guardrails**

```bash
npm run check:docs-drift
npm run check:report-freshness
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "Align documentation with cleanup wave"
```

---

### Task 7: Final Verification And Executive Closeout

**Files:**

- Modify: `reports/maintenance-debt-scorecard.md`
- Modify: `reports/quality-metrics.md`
- Modify: `docs/TECHNICAL_DEBT_REGISTER.md`

- [ ] **Step 1: Refresh final reports**

```bash
npm run report:maintenance-debt-scorecard
npm run report:quality-metrics
```

- [ ] **Step 2: Run full closeout verification**

```bash
npm run typecheck
npm run check:quality
npm run test:ci:unit
```

- [ ] **Step 3: Record residual watchlist**

Residuals should be:

- high-risk dead code not yet proven unused
- docs intentionally deferred
- tests kept for regression safety despite overlap

- [ ] **Step 4: Final commit**

```bash
git add reports docs
git commit -m "Close progressive cleanup wave"
```

---

## Recommended Execution Order

1. Baseline and inventory
2. Low-risk code/doc cleanup
3. Duplicate-test consolidation
4. Medium-risk module pruning
5. Documentation convergence
6. Final verification

## Opinion

Si, me parece una buena idea, pero solo si se hace asi:

- incremental
- guiado por evidencia
- con commits pequenos
- sin mezclar poda con cambios funcionales
- con checks verdes despues de cada lote

La mala version de esta idea es una “limpieza general” en una sola rama enorme. En este repo eso seria riesgoso y probablemente bajaria, no subiria, la confianza.

## Expected High-Value Outcomes

- menos costo cognitivo al navegar el repo
- menor drift entre codigo y documentacion
- menos ruido en tests y suites mas legibles
- menos superficie inutil para futuros refactors
- mejor nota de mantenibilidad sin tocar budgets ni maquillar scorecards
