# `src/services/repositories`

## Propósito

Implementar Repository Pattern para ocultar detalles de almacenamiento/sincronización.

## Mapa

| Archivo                                          | Rol                                           |
| ------------------------------------------------ | --------------------------------------------- |
| `DailyRecordRepository.ts`                       | API unificada del registro diario             |
| `dailyRecordRepositoryReadService.ts`            | Lecturas                                      |
| `dailyRecordRepositoryWriteService.ts`           | Escrituras                                    |
| `dailyRecordRepositorySyncService.ts`            | Suscripción/sync con Firestore                |
| `dailyRecordRepositoryInitializationService.ts`  | Inicialización de días/copia de paciente      |
| `repositoryConfig.ts`                            | Flags de repo (`firestoreEnabled`, demo mode) |
| `CatalogRepository.ts`                           | Catálogos                                     |
| `PatientMasterRepository.ts`                     | Base maestra de pacientes                     |
| `PrintTemplateRepository.ts`                     | Plantillas de impresión                       |
| `dataMigration.ts` / `patientMasterMigration.ts` | Migraciones                                   |
| `monthIntegrity.ts`                              | Integridad mensual                            |
| `index.ts`                                       | Barrel export                                 |

## Patrón de uso

```ts
const record = await DailyRecordRepository.getForDate(date);
await DailyRecordRepository.updatePartial(date, patch);
const unsubscribe = DailyRecordRepository.subscribe(date, callback);
```

## Regla

Todo acceso a `DailyRecord` debe pasar por este paquete (evitar acceso directo desde UI a storage).
