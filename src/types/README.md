# `src/types`

## Propósito

Contratos TypeScript de dominio, entidades, payloads y value objects.

## Mapa de archivos

| Archivo                 | Propósito                                                    |
| ----------------------- | ------------------------------------------------------------ |
| `core.ts`               | Fachada deprecated de compatibilidad hacia `types/domain/*`  |
| `domain/base.ts`        | Bed, specialty, status, shift y catálogo profesional         |
| `domain/clinical.ts`    | Clinical events, FHIR, CUDYR, dispositivos y patient master  |
| `domain/patient.ts`     | `PatientData` y contratos de handoff médico por paciente     |
| `domain/movements.ts`   | Altas, traslados, CMA e IEEH                                 |
| `domain/dailyRecord.ts` | `DailyRecord`, patching y contratos médicos por especialidad |
| `audit.ts`              | Tipos de auditoría                                           |
| `auth.ts`               | Tipos de autenticación/rol                                   |
| `backup.ts`             | Tipos de backup y restauración                               |
| `bookmarks.ts`          | Tipos de marcadores                                          |
| `minsalTypes.ts`        | Tipos de analítica MINSAL/DEIS                               |
| `transferDocuments.ts`  | Tipos de documentos de traslado                              |
| `transfers.ts`          | Tipos de flujo de traslados                                  |
| `valueTypes.ts`         | Tipos de valores auxiliares                                  |
| `whatsapp.ts`           | Tipos de integración WhatsApp                                |
| `global.d.ts`           | Extensiones globales de tipos                                |
| `index.ts`              | Barrel export de tipos                                       |

## Convención

- Evitar `any`; expresar contratos explícitos.
- Importar desde el owner real del contrato, no desde `core.ts`.
- `core.ts` existe solo como bridge temporal y no debe recibir imports productivos nuevos.
- `src/types/` es el owner canónico de tipos de dominio y payloads estables; `src/shared/` puede reexportar compatibilidad, pero no debe reemplazar ese ownership.
- Si una feature necesita un subtipo/fachada propia, debe declararla dentro de la feature o en `application/shared`, no reubicar la entidad base en `shared/`.

## Notas de dominio recientes

- `domain/patient.ts` persiste metadatos clínicos adicionales para pacientes
  `Ginecobstetricia`:
  - `ginecobstetriciaType`: distingue `Obstétrica` vs `Ginecológica` sin alterar la especialidad principal.
  - `deliveryRoute`: registra `Vaginal` o `Cesárea`.
  - `deliveryCesareanLabor`: detalla `Sin TdP` o `Con TdP` cuando aplica; es opcional y no reemplaza `deliveryRoute`.
- Estos campos son datos clínicos persistidos, no etiquetas visuales. Las abreviaturas de UI como
  `GyO` o `TMT` no cambian el valor canónico almacenado.
