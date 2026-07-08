# Documentation Map

Última actualización: 2026-07-02

> Índice único del repositorio. Si un documento nuevo no aparece aquí, o queda
> sin categoría, debe añadirse en el mismo PR que lo crea. `check:docs-drift`
> ayuda a detectar referencias rotas, no ausencias.

## Lectura recomendada

1. [README.md](../README.md)
2. [docs/RUNBOOK_INDEX.md](RUNBOOK_INDEX.md)
3. [docs/CODEBASE_CANON.md](CODEBASE_CANON.md)
4. [docs/FOUNDATION_TRACKER.md](FOUNDATION_TRACKER.md)
5. [PROJECT_STATUS.md](../PROJECT_STATUS.md)
6. README del módulo que vas a tocar en `src/features/*/README.md` o `src/*/README.md`

## Módulos canónicos por área

- Auth y acceso: [src/services/auth/README.md](../src/services/auth/README.md)
- Firebase runtime: [src/services/firebase-runtime/README.md](../src/services/firebase-runtime/README.md)
- Repositorios y `dailyRecord`: [src/services/repositories/README.md](../src/services/repositories/README.md)
- Clinical documents: [src/features/clinical-documents/README.md](../src/features/clinical-documents/README.md)
- Laboratory: [src/features/laboratory/README.md](../src/features/laboratory/README.md)

## Categorías

### Canónica

Documentos que gobiernan decisiones activas y estructura actual del repo.

- [README.md](../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [PROJECT_STATUS.md](../PROJECT_STATUS.md)
- [docs/CODEBASE_CANON.md](CODEBASE_CANON.md)
- [docs/GLOSSARY.md](GLOSSARY.md) — vocabulario canónico del dominio (paciente/cama/alta/traslado/CUDYR/CMA/MINSAL…)
- [docs/TODO_TRIAGE_PROCESS.md](TODO_TRIAGE_PROCESS.md) — playbook para mantener cero markers `TODO`/`FIXME` en código
- [docs/FOUNDATION_TRACKER.md](FOUNDATION_TRACKER.md)
- [docs/QUALITY_GUARDRAILS.md](QUALITY_GUARDRAILS.md)
- [docs/SAFE_CHANGE_CHECKLIST.md](SAFE_CHANGE_CHECKLIST.md)
- [docs/CLINICAL_MUTATION_AUDIT_POLICY.md](CLINICAL_MUTATION_AUDIT_POLICY.md) — postura de auditoría declarada por `AuditAction` (gate `check:clinical-mutation-audit-policy`)

#### ADRs

Cada ADR declara su `**Estado:**` en la primera línea después del título:
`Vigente`, `Superseded by <X>` o `Histórico`. Si se marca superseded, el PR debe
actualizar el `Estado` y apuntar al ADR reemplazante.

- [ADR_ACCESS_POLICY_FACADE](ADR_ACCESS_POLICY_FACADE.md) — Vigente
- [ADR_APPLICATION_BOUNDARY_ENFORCEMENT](ADR_APPLICATION_BOUNDARY_ENFORCEMENT.md) — Vigente
- [ADR_APPLICATION_USE_CASES](ADR_APPLICATION_USE_CASES.md) — Vigente
- [ADR_AUTH_RUNTIME_RECOVERY](ADR_AUTH_RUNTIME_RECOVERY.md) — Vigente
- [ADR_CANONICAL_WRITE_ADOPTION_FACADES](ADR_CANONICAL_WRITE_ADOPTION_FACADES.md) — Vigente
- [ADR_CANONICAL_WRITE_COMMANDS](ADR_CANONICAL_WRITE_COMMANDS.md) — Vigente
- [ADR_CENSUS_WORKBOOK_PROTECTION](ADR_CENSUS_WORKBOOK_PROTECTION.md) — Aprobado
- [ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT](ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md) — Vigente
- [ADR_CLINICAL_EPISODE_MODEL](ADR_CLINICAL_EPISODE_MODEL.md) — Vigente
- [ADR_CONFLICT_VERSION_RECOVERY](ADR_CONFLICT_VERSION_RECOVERY.md) — Aceptada
- [ADR_CONTROLLER_DECOMPOSITION_PATTERN](ADR_CONTROLLER_DECOMPOSITION_PATTERN.md) — Vigente
- [ADR_DAILY_RECORD_RUNTIME_PATH](ADR_DAILY_RECORD_RUNTIME_PATH.md) — Vigente
- [ADR_DAILY_CENSUS_TRUTH_CONTRACT](ADR_DAILY_CENSUS_TRUTH_CONTRACT.md) — Vigente
- [ADR_DAILY_CENSUS_MOVEMENT_CONFLICT_INVARIANTS](ADR_DAILY_CENSUS_MOVEMENT_CONFLICT_INVARIANTS.md) — Vigente
- [ADR_DEBOUNCED_INPUT_MULTITAB_SAFETY](ADR_DEBOUNCED_INPUT_MULTITAB_SAFETY.md) — Vigente
- [ADR_HANDOFF_RUNTIME_SURFACES](ADR_HANDOFF_RUNTIME_SURFACES.md) — Vigente
- [ADR_PATIENT_CENTERED_OBSERVABILITY](ADR_PATIENT_CENTERED_OBSERVABILITY.md) — Adoptado
- [ADR_REPOSITORY_PROVIDER_REQUIRED](ADR_REPOSITORY_PROVIDER_REQUIRED.md) — Vigente
- [ADR_SYNC_OUTCOME_POLICY](ADR_SYNC_OUTCOME_POLICY.md) — Vigente

#### Runbooks

- [RUNBOOK_INDEX](RUNBOOK_INDEX.md) — puerta de entrada operativa única
- [RUNBOOK_AUTH_ACCESS_INCIDENTS](RUNBOOK_AUTH_ACCESS_INCIDENTS.md) — incidentes de acceso de usuario
- [RUNBOOK_SECRET_ROTATION](RUNBOOK_SECRET_ROTATION.md) — inventario único y rotación de credenciales
- [RUNBOOK_SYNC_RESILIENCE](RUNBOOK_SYNC_RESILIENCE.md) — sync, cola y recuperación offline
- [RUNBOOK_SUPPORT_OPERATIONS](RUNBOOK_SUPPORT_OPERATIONS.md) — soporte técnico general
- [RUNBOOK_DAILY_ADMIN_CHECKLIST](RUNBOOK_DAILY_ADMIN_CHECKLIST.md) — checklist diario 1 página
- [RUNBOOK_AI_PROVIDER_OPERATIONS](RUNBOOK_AI_PROVIDER_OPERATIONS.md) — providers AI (Gemini/OpenAI/Anthropic)
- [RUNBOOK_OPERATIONAL_BUDGETS](RUNBOOK_OPERATIONAL_BUDGETS.md) — presupuestos operacionales
- [RUNBOOK_DAILY_CENSUS_RECOVERY](RUNBOOK_DAILY_CENSUS_RECOVERY.md) — recuperación de altas, movimientos y conflictos del censo diario
- [RUNBOOK_NETLIFY_SERVERLESS_DEPLOY](RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md) — deploy serverless
- [CI_GATES_AND_FAILURE_RUNBOOKS](CI_GATES_AND_FAILURE_RUNBOOKS.md) — gates de CI y recuperación
- [TEST_FLAKY_QUARANTINE_POLICY](TEST_FLAKY_QUARANTINE_POLICY.md) — cuarentena de tests flaky
- [RUNBOOK_LOCAL_E2E_EMULATOR](RUNBOOK_LOCAL_E2E_EMULATOR.md) — correr E2E con emulador Firestore en local

### Operativa

Documentos que ayudan a ejecutar trabajo, validar cambios o entender un área concreta.

- `docs/testing/*`
- `docs/features/*`
- `docs/architecture/*`
- `docs/compliance/*`
- README por módulo en `src/`
- [docs/DEVELOPER_COMMANDS.md](DEVELOPER_COMMANDS.md)
- [rules/README.md](../rules/README.md)
- [docs/TEST_MEGATEST_BACKLOG.md](TEST_MEGATEST_BACKLOG.md)
- [docs/architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md](architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)

### Histórica o de trabajo

Documentos útiles para contexto, pero no fuente primaria de reglas activas.

- `docs/*PHASE*_README.md`
- `docs/*EXECUTION*.md`
- `docs/*TRACKER*.md`
- `docs/MODULE_EVALUATION_*.md`
- `docs/superpowers/plans/*.md`
- `docs/superpowers/specs/*.md`
- `docs/FOUNDATION_IMPROVEMENT_PLAN.md`
- `docs/FOUNDATION_CONTINUATION_TRACKER.md`
- `docs/MAINTENANCE_ITERATION_LOG.md`

### Generada

Artefactos producidos por tooling o reportes automáticos. Son útiles para consulta, pero no son la fuente primaria de diseño.

- `docs/api/**`
- `reports/**/*.md`
- `reports/**/*.json`

## Reglas de mantenimiento

- Si un documento describe decisiones activas del código, debe estar en la categoría canónica u operativa.
- Si un archivo se regenera desde scripts o CI, debe tratarse como generado aunque esté versionado.
- No duplicar decisiones arquitectónicas entre documentos generados y canónicos.
- Si un documento canónico cambia una regla, el tracker y el README correspondiente deben quedar alineados en la misma iteración.
- Si una decisión ya quedó resumida en un README de módulo, los planes, trackers y phase notes deben enlazarlo en vez de repetir la regla completa.
- Las rutas internas de documentación deben ser relativas al repo. No agregar rutas absolutas locales ni URLs de archivo local.
- Las compatibilidades legacy de roles/auth/rules se documentan como protección de migración hasta que la app sea oficial; no deben crecer con consumidores nuevos.

## Decisión sobre `docs/api`

- Se mantiene versionado por ahora como referencia offline y para revisión local rápida.
- Se considera generado y de solo consulta.
- No debe editarse manualmente.
- Si en el futuro CI publica artefactos navegables externos, este directorio es candidato a salir del repositorio.

## Decisión sobre `reports`

- `reports/` se mantiene versionado mientras siga siendo parte del flujo local de gobernanza.
- Cada reporte es un snapshot generado, no un documento narrativo de arquitectura.
- Las decisiones activas deben resumirse en documentación canónica, no delegarse a un reporte.
