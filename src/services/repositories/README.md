# Repositorios

Este paquete implementa persistencia, reconciliación y compatibilidad. UI y casos
de uso consumen los ports existentes de `src/application/ports/`; el wiring usa
`RepositoryContext`. No reintroducir `DailyRecordRepository.ts` ni `index.ts`:
ambas fachadas amplias fueron retiradas.

## Camino del registro diario

```text
query / comando / suscripción
  -> port dailyRecord
  -> servicio específico de lectura, escritura, sync o inicialización
  -> políticas de autoridad, consistencia y concurrencia
  -> storage local/remoto -> outcome -> caché/UI
```

| Módulo dueño                                      | Responsabilidad                                   |
| ------------------------------------------------- | ------------------------------------------------- |
| `dailyRecordRepositoryReadService.ts`             | Lectura y resultado con metadata                  |
| `dailyRecordRepositoryWriteService.ts`            | Guardado y patches, validación y recuperación     |
| `dailyRecordRepositorySyncService.ts`             | Suscripción, reconciliación y adopción confirmada |
| `dailyRecordRepositoryInitializationService.ts`   | Inicialización de un día y copia de paciente      |
| `dailyRecordDeletionService.ts`                   | Eliminación protegida por día y papelera remota   |
| `dailyRecordPersistenceGoldenPath.ts`             | Selección canónica de candidato local/remoto      |
| `dailyRecordConsistencyPolicy.ts` y `contracts/*` | Estados, inputs y resultados tipados              |
| `repositoryConfig.ts`                             | Disponibilidad del runtime remoto                 |

No tratar un `null`, una copia local o un error remoto como confirmación de ausencia.
Conservar el outbox, las revisiones y el resultado de autoridad del comando. El
orden de persistencia depende de la política existente, no de una regla general
«local primero». La eliminación confirma el borrado local antes de continuar al
remoto; mantiene exclusión por fecha, protección del outbox y validación del comando.

La implementación específica puede usar otros soportes internos del paquete.
Crear un helper sólo si contiene una decisión o elimina duplicación real; no
volver a envolver constructores de `contracts/*` sin añadir comportamiento.
Las factories existentes permiten inyectar runtime en los repositorios que usan
primitives Firestore; no sustituirlas por nuevos singletons internos.

## Compatibilidad y migración

- `dataMigration.ts` normaliza payloads históricos antes de usar el modelo actual.
- `schemaGovernance.ts`, `schemaEvolutionPolicy.ts` y `migrationLedger.ts` definen
  versión y evolución; la compatibilidad histórica permanece protegida.
- `legacyRecordBridgeService.ts` es el acceso explícito al bridge de registros.
  No integrarlo al hot path ni abrirlo desde un barrel de conveniencia.
- `legacyBridgeGovernance.ts` y `legacyBridgeAudit.ts` gobiernan su uso y retiro.
- Catálogos conservan su fallback en `legacyCatalogReadBridge`; no confundirlo
  con lectura ordinaria de registros diarios.
- `runtimeCompatibilityPolicy.ts` clasifica la compatibilidad cliente/backend y
  las restricciones de versión; `runtimeContractGovernance.ts` cruza contratos
  runtime, versiones de schema y el ledger de migración.
- `dailyRecordAggregate.ts` concentra las operaciones del agregado.

Los informes generados son evidencia, no otra implementación de la política:
`reports/legacy-bridge-governance.md`, `reports/runtime-contracts.md`,
`reports/schema-evolution.md` y `reports/operational-health.md`.
No retirar lectores históricos, aliases o grace paths sin demostrar que sus
consumidores operativos desaparecieron.

## Cambiar y verificar

La autoridad y la precedencia se documentan una sola vez en
[Daily Record Runtime Path](../../../docs/ADR_DAILY_RECORD_RUNTIME_PATH.md),
[Daily Census Truth Contract](../../../docs/ADR_DAILY_CENSUS_TRUTH_CONTRACT.md) y
[Sync Outcome Policy](../../../docs/ADR_SYNC_OUTCOME_POLICY.md).

Elegir las suites del servicio y sus consumidores. Para eliminación, conservar
las pruebas existentes de port, lectura, persistencia, concurrencia y outbox;
no añadir una suite sólo para comprobar que un wrapper delega. Los estados y
fallos deben probarse como comportamiento observable del límite responsable.

- [Cómo contribuir](../../../CONTRIBUTING.md)
- [Checklist de cierre](../../../docs/SAFE_CHANGE_CHECKLIST.md)
- [Runbook de sync](../../../docs/RUNBOOK_SYNC_RESILIENCE.md)
- [docs/RUNBOOK_OPERATIONAL_BUDGETS.md](../../../docs/RUNBOOK_OPERATIONAL_BUDGETS.md)
- [Storage y cola](../storage/README.md)
