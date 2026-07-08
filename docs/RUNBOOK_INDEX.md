# Runbook Index

Última actualización: 2026-04-20

Puerta de entrada operativa única. Antes de abrir varios documentos, parte aquí
según el tipo de incidente o cambio.

## Arranque rápido por escenario

### Acceso, login o permisos

Usa cuando:

- un usuario debería entrar y no puede
- un usuario removido todavía entra
- `localhost` y Netlify se comportan distinto
- el login termina pero no aparece el shell

Abrir en este orden:

1. [AUTH_ACCESS_MODEL.md](./AUTH_ACCESS_MODEL.md)
2. [RUNBOOK_AUTH_ACCESS_INCIDENTS.md](./RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
3. [RUNBOOK_SECRET_ROTATION.md](./RUNBOOK_SECRET_ROTATION.md) solo si el incidente implica credenciales o compromiso de secretos

### Sync, IndexedDB, outbox o degradación clínica local

Usa cuando:

- hay `failedSyncTasks`, `conflictSyncTasks` o colas atascadas
- aparece fallback de IndexedDB o banner de resiliencia
- hay dudas sobre conflictos de concurrencia o recuperación offline
- un alta, traslado o conflicto del censo no coincide entre observabilidad y el estado visible

Abrir en este orden:

1. [RUNBOOK_DAILY_ADMIN_CHECKLIST.md](./RUNBOOK_DAILY_ADMIN_CHECKLIST.md)
2. [RUNBOOK_DAILY_CENSUS_RECOVERY.md](./RUNBOOK_DAILY_CENSUS_RECOVERY.md)
3. [RUNBOOK_SUPPORT_OPERATIONS.md](./RUNBOOK_SUPPORT_OPERATIONS.md)
4. [RUNBOOK_SYNC_RESILIENCE.md](./RUNBOOK_SYNC_RESILIENCE.md)
5. [RUNBOOK_OPERATIONAL_BUDGETS.md](./RUNBOOK_OPERATIONAL_BUDGETS.md)

### Reglas, Firestore/Storage o runtime sensible

Usa cuando:

- cambias `firestore.rules` o `storage.rules`
- falla `check:security`, `test:rules:ci` o el emulador
- necesitas regenerar outputs raíz desde fragmentos

Abrir en este orden:

1. [../rules/README.md](../rules/README.md)
2. [FIREBASE_POLICY.md](./FIREBASE_POLICY.md)
3. [RUNBOOK_SYNC_RESILIENCE.md](./RUNBOOK_SYNC_RESILIENCE.md)
4. [SERVERLESS_SENSITIVE_CONTRACTS.md](./SERVERLESS_SENSITIVE_CONTRACTS.md) si el cambio toca functions/endpoints sensibles

Comandos mínimos:

- `npm run build:rules-assets`
- `npm run check:security`
- `bash scripts/run-firestore-rules-ci.sh`

### Deploy Netlify, bundling o Functions

Usa cuando:

- falla el empaquetado o runtime de `netlify/functions`
- hay drift de Node/versiones
- el deploy preview o productivo falla fuera del frontend puro

Abrir en este orden:

1. [RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md](./RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md)
2. [CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md)
3. [SERVERLESS_SENSITIVE_CONTRACTS.md](./SERVERLESS_SENSITIVE_CONTRACTS.md)

### Recetas, respaldo mensual o eliminación manual

Usa cuando:

- necesitas cerrar el respaldo mensual de recetas
- vas a eliminar recetas desde el visor
- quieres confirmar que no hay eliminación automática programada

Abrir en este orden:

1. [RUNBOOK_PRESCRIPTIONS_BACKUP.md](./RUNBOOK_PRESCRIPTIONS_BACKUP.md)
2. [CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md) si el cambio requiere deploy de Functions

### Release, preview o gates de CI

Usa cuando:

- necesitas decidir qué gate correr
- falla `ci:pre-merge`, `ci:merge-gate` o `ci:release-gate`
- quieres un mapa corto de recovery por falla

Abrir en este orden:

1. [DEVELOPER_COMMANDS.md](./DEVELOPER_COMMANDS.md)
2. [CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md)
3. [RUNBOOK_PROFESSIONAL_RELEASE_CHECK.md](./RUNBOOK_PROFESSIONAL_RELEASE_CHECK.md)
4. [QUALITY_GUARDRAILS.md](./QUALITY_GUARDRAILS.md)

### Operación AI, integraciones externas y secretos

Usa cuando:

- falla un provider AI
- hay rotación o compromiso de secretos
- necesitas confirmar contratos operativos de endpoints sensibles

Abrir en este orden:

1. [RUNBOOK_AI_PROVIDER_OPERATIONS.md](./RUNBOOK_AI_PROVIDER_OPERATIONS.md)
2. [RUNBOOK_SECRET_ROTATION.md](./RUNBOOK_SECRET_ROTATION.md)
3. [SERVERLESS_SENSITIVE_CONTRACTS.md](./SERVERLESS_SENSITIVE_CONTRACTS.md)

### E2E local con emuladores

Usa cuando:

- quieres correr el loop crítico local con Firestore Emulator
- estás investigando blank page o bootstrap en preview/emulador

Abrir en este orden:

1. [RUNBOOK_LOCAL_E2E_EMULATOR.md](./RUNBOOK_LOCAL_E2E_EMULATOR.md)
2. [CI_GATES_AND_FAILURE_RUNBOOKS.md](./CI_GATES_AND_FAILURE_RUNBOOKS.md)
3. [RUNBOOK_OPERATIONAL_BUDGETS.md](./RUNBOOK_OPERATIONAL_BUDGETS.md)

## Documentos de entrada recomendados

- Para orientarte en el repo completo: [DOCUMENTATION_MAP.md](./DOCUMENTATION_MAP.md)
- Para comandos curados: [DEVELOPER_COMMANDS.md](./DEVELOPER_COMMANDS.md)
- Para decisiones canónicas de estructura: [CODEBASE_CANON.md](./CODEBASE_CANON.md)
- Para el plan activo de mejoras por bloques: [superpowers/plans/2026-04-20-audit-block-roadmap.md](./superpowers/plans/2026-04-20-audit-block-roadmap.md)

## Regla de mantenimiento

Si se agrega un runbook nuevo o cambia el punto de entrada recomendado para un
incidente, este índice debe actualizarse en el mismo PR.
