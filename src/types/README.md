# `src/types`

## Propósito

Contratos TypeScript de dominio, entidades, payloads y value objects.

## Mapa de archivos

| Archivo                | Propósito                                                            |
| ---------------------- | -------------------------------------------------------------------- |
| `core.ts`              | Tipos centrales del dominio clínico (DailyRecord, PatientData, etc.) |
| `audit.ts`             | Tipos de auditoría                                                   |
| `auth.ts`              | Tipos de autenticación/rol                                           |
| `backup.ts`            | Tipos de backup y restauración                                       |
| `bookmarks.ts`         | Tipos de marcadores                                                  |
| `censusAccess.ts`      | Tipos de acceso compartido al censo                                  |
| `minsalTypes.ts`       | Tipos de analítica MINSAL/DEIS                                       |
| `printTemplates.ts`    | Tipos de templates de impresión                                      |
| `transferDocuments.ts` | Tipos de documentos de traslado                                      |
| `transfers.ts`         | Tipos de flujo de traslados                                          |
| `valueTypes.ts`        | Tipos de valores auxiliares                                          |
| `whatsapp.ts`          | Tipos de integración WhatsApp                                        |
| `global.d.ts`          | Extensiones globales de tipos                                        |
| `index.ts`             | Barrel export de tipos                                               |

## Convención

- Evitar `any`; expresar contratos explícitos.
- Promover tipos reutilizables desde `core.ts` hacia features.
