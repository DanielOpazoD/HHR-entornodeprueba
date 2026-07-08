# `src/services/repositories`

## Propósito

Implementar Repository Pattern para ocultar detalles de almacenamiento/sincronización.

## Flujo principal de `dailyRecord`

1. `dailyRecordRepositoryReadService.ts` resuelve lectura local/remota y consistencia visible.
2. `dailyRecordRepositoryWriteService.ts` valida, guarda local y decide recovery remoto.
3. `dailyRecordRepositorySyncService.ts` sincroniza o subscribe usando el mismo golden path.
4. `dailyRecordPersistenceGoldenPath.ts` decide cuándo manda remoto o local.
5. `dailyRecordConsistencyPolicy.ts` traduce esa decisión a `consistencyState`, `sourceOfTruth`,
   `retryability` y `recoveryAction`.

## Puntos de falla que revisar primero

- remoto más viejo que local: debe mantenerse `local_authoritative` o `local_kept`
- remoto ausente: debe salir `missing_remote`, no “éxito vacío”
- remoto caído: debe degradar a fallback local con `defer_remote_sync`
- conflictos de escritura: recovery explícito (`queue_retry`, `auto_merge_and_queue`, `block_and_surface`)
- hidratación local desde remoto: debe respetar las mismas invariantes y policy de `admissionDate`

## Mapa

| Archivo                                                          | Rol                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DailyRecordRepository.ts`                                       | Fachada legacy mínima del registro diario                                                                 |
| `dailyRecordRepositoryReadService.ts`                            | Lecturas                                                                                                  |
| `dailyRecordRepositoryWriteService.ts`                           | Escrituras                                                                                                |
| `dailyRecordRepositorySyncService.ts`                            | Suscripción/sync con Firestore                                                                            |
| `dailyRecordRepositoryInitializationService.ts`                  | Inicialización de días/copia de paciente                                                                  |
| `repositoryConfig.ts`                                            | Runtime liviano de sync (`enabled / local_only`) + estado derivado (`ready / bootstrapping / local_only`) |
| `CatalogRepository.ts`                                           | Catálogos                                                                                                 |
| `PatientMasterRepository.ts`                                     | Base maestra de pacientes                                                                                 |
| `PrintTemplateRepository.ts`                                     | Plantillas de impresión                                                                                   |
| `dataMigration.ts` / `patientMasterMigration.ts`                 | Migraciones                                                                                               |
| `schemaGovernance.ts` / `schemaEvolutionPolicy.ts`               | Política de versionado y compatibilidad                                                                   |
| `runtimeCompatibilityPolicy.ts` / `runtimeContractGovernance.ts` | Compatibilidad runtime end-to-end                                                                         |
| `legacyRecordBridgeService.ts`                                   | Importación explícita desde rutas legacy de `DailyRecord`                                                 |
| `legacyBridgeGovernance.ts` / `legacyBridgeAudit.ts`             | Gobernanza y auditoría del bridge legacy                                                                  |
| `monthIntegrity.ts`                                              | Integridad mensual                                                                                        |
| `contracts/*.ts`                                                 | Contratos estrictos de entrada/salida                                                                     |
| `index.ts`                                                       | Barrel export                                                                                             |

## Patrón de uso

```ts
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { subscribe } from '@/services/repositories/dailyRecordRepositorySyncService';

const record = await getForDate(date);
await updatePartial(date, patch);
const unsubscribe = subscribe(date, callback);
```

## Decision Guide

- Runtime path y precedence de `daily-record`: [docs/ADR_DAILY_RECORD_RUNTIME_PATH.md](../../../docs/ADR_DAILY_RECORD_RUNTIME_PATH.md)
- Outcome policy de sync: [docs/ADR_SYNC_OUTCOME_POLICY.md](../../../docs/ADR_SYNC_OUTCOME_POLICY.md)
- Runbook operativo de sync: [docs/RUNBOOK_SYNC_RESILIENCE.md](../../../docs/RUNBOOK_SYNC_RESILIENCE.md)

## Regla

Todo acceso a `DailyRecord` debe pasar por este paquete (evitar acceso directo desde UI a storage).
Código nuevo debe preferir servicios/ports específicos; `DailyRecordRepository.ts` queda para compatibilidad controlada.

Los métodos públicos de `DailyRecordRepository` y `PatientMasterRepository` validan/sanean contratos
de entrada (fecha, límites, RUT, IDs) antes de delegar en storage.

Los repositorios que todavía requieren primitives Firestore deben exponer una factory inyectable y
dejar el runtime por defecto solo como composición. El repositorio no debe depender de
`defaultFirestoreRuntime` como singleton interno.

## Compatibilidad Histórica de Sync

- La compatibilidad con datos legacy que llegan desde la version oficial antigua por Firebase sigue
  siendo un invariante productivo. La simplificacion estructural no debe tocar ni retirar:
  - `dataMigration.ts`
  - `schemaGovernance.ts`
  - `schemaEvolutionPolicy.ts`
  - `legacyCompatibilityPolicy.ts`
  - los grace paths de reglas/runtime que permiten abrir registros historicos
- La regla operativa es `leer y normalizar`: la app acepta payloads antiguos, los migra al modelo
  canonico actual y sigue operando internamente sobre ese formato.

- `dailyRecordRepositoryInitializationService.ts` conserva bootstrap compatible con:
  - registros ya presentes en IndexedDB
  - lectura remota actual desde Firestore
  - creación en blanco o desde copia local cuando no existe remoto actual
- `dailyRecordRemoteLoader.ts` quedó restringido al remoto vigente (`Firestore -> cache local`).
  La compatibilidad histórica dejó de formar parte del camino caliente.
- `dailyRecordPersistenceGoldenPath.ts` define ahora la precedencia canónica del hot path:
  - `read` y `sync` resuelven la misma selección `local vs remote`
  - la hidratación de IndexedDB ocurre solo si la policy selecciona remoto
  - un remoto más viejo ya no puede sobrescribir una copia local más reciente
- `legacyRecordBridgeService.ts` es la única vía soportada para importar datos legacy de
  `DailyRecord`; internamente entra por `storage/migration/legacyRecordReadBridge`.
- `CatalogRepository.ts` mantiene el fallback legacy de catálogos únicamente a través de
  `storage/migration/legacyCatalogReadBridge`.
- El shim amplio de compatibilidad Firestore legacy fue retirado; los consumidores deben usar los
  bridges angostos anteriores.
- El bridge legacy ya no sale por el barrel general de `repositories`; cualquier uso nuevo debe
  importar el módulo explícito o pasar por `DailyRecordRepository.bridgeLegacyRecord`.
- `legacyBridgeAudit.ts` mantiene un ledger liviano de uso del bridge (`single`/`range`,
  `legacy_bridge`/`not_found`/`disabled`) para que el uso restante sea observable.
- `legacyBridgeGovernance.ts` define las reglas de retiro progresivo del bridge y las
  entrypoints permitidas; `reports/legacy-bridge-governance.md` resume esa política.
- `repositoryPerformance.ts` concentra la telemetría ligera de operaciones críticas (`getForDate`,
  `initializeDay`, `syncWithFirestore`, `ensureMonthIntegrity`) para evitar mediciones dispersas.
- `dailyRecordRepositoryInitializationService.ts` resuelve una semilla de arranque explícita
  (`remote_firestore`, `copy_source`, `fresh`) antes de construir o reutilizar
  el día, evitando mezclar en un mismo bloque la carga remota, la herencia local y la creación
  del registro nuevo.
- `dailyRecordRepositoryWriteService.ts` aplica una policy compartida de recuperación de escritura:
  - validación de compatibilidad antes de guardar completo
  - control de concurrencia también en `updatePartial`
  - auto-merge auditado solo cuando existe un remoto recuperable
  - rechazo explícito si el conflicto no puede resolverse sin arriesgar pérdida de datos
- `contracts/dailyRecordConsistency.ts` y `dailyRecordConsistencyPolicy.ts` formalizan el
  contrato canónico de consistencia:
  - `consistencyState` como semántica principal para lectura/escritura/sync
  - `sourceOfTruth`, `retryability`, `recoveryAction` y `conflictSummary`
  - compatibilidad temporal con `outcome`/`source` legacy para no romper consumers de golpe
- `dailyRecordRecoveryPolicy.ts` concentra las decisiones explícitas de recuperación
  (`queue_retry`, `auto_merge_and_queue`, `block_and_surface`, `defer_remote_sync`) para que
  write/sync y telemetría hablen el mismo idioma del dominio.
- `dataMigration.ts` sigue siendo el punto único para adaptar shapes legacy al schema vigente, y
  expone un reporte de reglas aplicadas y una intensidad de compatibilidad para distinguir entre
  normalización liviana, promoción de staff legacy y puentes de schema histórico.
- La reconciliación legacy de identidad también debe canonizar `patientName` vs name parts,
  `documentType`, valores documentales inválidos (`null`, `undefined`, `N/A`) e
  `identityStatus` antes de que el registro llegue a UI o view-models. Esa corrección pertenece a
  `dataMigration.ts`, no a componentes del censo.
- `schemaEvolutionPolicy.ts` y `migrationLedger.ts` definen la estrategia de evolución:
  - versión actual soportada por runtime
  - compatibilidad hacia adelante
  - qué cambios requieren bridge legacy o migración normal
- `runtimeCompatibilityPolicy.ts` formaliza la compatibilidad entre cliente, schema y contrato
  backend para evitar drift silencioso entre despliegues.
- `runtimeContractGovernance.ts` cruza contrato cliente/backend, schema vigente, legacy floor,
  migradores disponibles y ledger de evolución; `reports/runtime-contracts.md` publica ese
  snapshot como artefacto derivado.
- `reports/schema-evolution.md` y `reports/schema-evolution.json` entregan un snapshot
  legible del ledger de evolución para soporte y revisión técnica.
- `dailyRecordAggregate.ts` expone facetas del dominio (`clinical`, `staffing`, `movements`,
  `handoff`, `metadata`) para bajar acoplamiento sobre el contrato monolítico de `DailyRecord`.
- `dailyRecordClinicalDomainService.ts`, `dailyRecordStaffingDomainService.ts`,
  `dailyRecordHandoffDomainService.ts`, `dailyRecordMovementsDomainService.ts` y
  `dailyRecordMetadataDomainService.ts` concentran reglas por contexto y mantienen
  `dailyRecordInitializationSupport.ts` y `dailyRecordWriteSupport.ts` como orquestadores.
- `contracts/dailyRecordDomainContracts.ts` y `dailyRecordDomainServices.ts` exponen
  clasificación y reexports curados para que los contextos internos no ensanchen la API pública.
- Si se cambia cualquier regla de compatibilidad, deben actualizarse:
  - tests de `dataMigration`
  - tests de `dailyRecordRemoteLoader`
  - tests de `DailyRecordRepository`
  - al menos una prueba de integración de sync

## Contrato y límites

- `DailyRecordRepository.ts` debe seguir siendo una fachada mínima; la lógica de lectura,
  escritura, sync, lifecycle e inicialización vive en servicios dedicados.
- `executeInitializeDailyRecord` y los hooks de persistencia no deben usar excepciones para
  representar fallas esperadas de inicialización; esas rutas deben salir con outcomes/notices
  tipados para no mezclar errores normales con fallas inesperadas.
- Los permisos operativos sobre reinicio/eliminación de días deben salir de policies compartidas
  (`operationalAccessPolicy` / controllers dueños) para que UI y runtime no diverjan.
- Los warnings de sync degradado o fallback local deben mantenerse como feedback recuperable;
  no deben presentarse como error crítico si el registro quedó usable o guardado localmente.
- `repositoryConfig.ts` debe mantenerse pequeño:
  - `setFirestoreEnabled` es el switch mutable que activa/desactiva Firestore para los repositorios
  - `resolveRemoteSyncRuntimeStatus` deriva el estado visible (`ready / bootstrapping / local_only`)
    solo desde auth (`isLoading`) y conectividad Firebase (`isFirebaseConnected`)
  - no reintroducir una FSM paralela en este módulo
- `useAppBootstrapState.ts` es quien sincroniza `setFirestoreEnabled(auth.isFirebaseConnected)` durante el arranque.
- `useDailyRecordQuery.ts` decide `syncFromRemote` usando ese switch y `remoteSyncStatus`; si el runtime pasa de no listo a `ready`, hace un `refetch` simple.
- `dailyRecordRemoteLoader.ts` debe distinguir `missing` de `failed`: un fetch remoto fallido no puede degradarse silenciosamente a "no existe registro".
- Los estados visibles de refresh/sync deben reutilizar el vocabulario operativo compartido
  (`degraded`, `retrying`, `blocked`, `read_only`, `not_verified`) para que el mismo outcome
  tenga la misma severidad y copy dentro y fuera de `daily-record`.
- `dailyRecordRemoteLoader.ts` ya no debe decidir por sí solo cuándo hidratar IndexedDB; esa
  decisión pertenece al golden path de persistencia y a la policy de consistencia compartida.
- `repositories/index.ts` debe permanecer explícito y pequeño; código nuevo debe importar
  desde el módulo concreto del repositorio en vez de expandir el barrel.
- Los servicios `dailyRecord*DomainService.ts` son internos al paquete `repositories`;
  nuevos consumidores deben preferir la fachada del repositorio o los soportes existentes,
  no importarlos desde UI o features.
- Los bridges legacy se invocan solo de forma explícita desde `legacyRecordBridgeService.ts`.
- `scripts/check-legacy-bridge-boundary.mjs` bloquea imports nuevos fuera de los importers
  permitidos por gobernanza para que el bridge no vuelva al hot path por conveniencia.
- Si cambia la política de retiro o el modo de compatibilidad, deben actualizarse en conjunto:
  - `legacyCompatibilityPolicy.ts`
  - `legacyBridgeGovernance.ts`
  - `legacyRecordBridgeService.ts`
  - `reports/legacy-bridge-governance.md`
  - `reports/operational-health.md`
- Cambios en schema/versionado deben tocar en conjunto:
  - `schemaEvolutionPolicy.ts`
  - `migrationLedger.ts`
  - `schemaGovernance.ts`
  - `dataMigration.ts`
- Cambios en contrato runtime/backend deben tocar en conjunto:
  - `src/constants/runtimeContracts.ts`
  - `functions/lib/runtime/runtimeContract.js`
  - `runtimeCompatibilityPolicy.ts`
  - `runtimeContractGovernance.ts`
  - `reports/runtime-contracts.md`
- Si una operación crítica cambia de costo esperado, debe actualizarse la medición en
  `repositoryPerformance.ts` y regenerarse `reports/operational-health.md`.
- Si cambia el contrato visible de lectura/suscripción del día actual, debe revisarse también
  `docs/ADR_DAILY_RECORD_RUNTIME_PATH.md`.
- Si cambia la clasificación o remediación de conflictos por contexto, debe actualizarse también
  `docs/RUNBOOK_OPERATIONAL_BUDGETS.md`.

## Checks recomendados

- `npm run typecheck`
- `npx vitest run src/tests/services/repositories/dailyRecordRepositoryReadService.test.ts src/tests/services/repositories/dailyRecordRepositoryWriteService.test.ts src/tests/services/repositories/dailyRecordRepositorySyncService.test.ts`
- `npx vitest run src/tests/security/dailyRecordRootImportGovernanceStatic.test.ts src/tests/security/dailyRecordContractsImportGovernanceStatic.test.ts`
