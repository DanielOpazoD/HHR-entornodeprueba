# `src/services`

## Propósito

Capa de datos e integración: repositorios, persistencia, exportadores, integraciones externas y servicios de dominio técnico.

## Mapa por subdirectorio

| Subdirectorio                                                 | Rol                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `repositories/`                                               | Repository Pattern para `DailyRecord` y catálogos     |
| `storage/`                                                    | IndexedDB, localStorage, Firestore sync y colas       |
| `integrations/`                                               | Conectores a servicios externos (email, IA, etc.)     |
| `exporters/`                                                  | Exportación Excel/reportes                            |
| `admin/`                                                      | Servicios de auditoría, mantenimiento y salud         |
| `transfers/`                                                  | Generación documental y soporte de traslados          |
| `auth/`                                                       | Servicios de autenticación/pasaporte offline          |
| `backup/`                                                     | Respaldo y restauración                               |
| `terminology/`                                                | Normalización y búsquedas semánticas clínicas         |
| `utils/`                                                      | Utilidades de servicio (logging, feature flags, etc.) |
| `pdf/`                                                        | Generadores PDF                                       |
| `security/`                                                   | Helpers de contraseña/export seguro                   |
| `calculations/`                                               | Cálculos estadísticos                                 |
| `bookmarks/`, `census/`, `config/`, `email/`, `google/`, etc. | Servicios especializados por dominio                  |

## Archivos raíz relevantes

| Archivo                  | Propósito                                           |
| ------------------------ | --------------------------------------------------- |
| `RepositoryContext.tsx`  | Inyección de repositorios en runtime                |
| `dataService.ts`         | Servicio de datos consolidado legacy/compatibilidad |
| `ExcelParsingService.ts` | Parsing Excel de soporte                            |
| `index.ts`               | Barrel export de servicios                          |

## Patrones clave

- **Repository Pattern** (`DailyRecordRepository`, `CatalogRepository`, etc.).
- **Service split por responsabilidad** (`read/write/sync/init` en repositorio diario).
- **Storage abstraction** con estrategia offline-first y fallback.

## Ejemplo

```ts
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';

await DailyRecordRepository.save(record);
```

## Convención de capa

- No importar componentes ni hooks de UI desde `services`.
- Mantener contratos de entrada/salida tipados (preferir `types`/`schemas`).
