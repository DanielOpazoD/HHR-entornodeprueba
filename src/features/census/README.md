# `src/features/census`

## Propósito

Módulo central del producto: censo diario, acciones sobre camas/pacientes, movimientos (alta/traslado/move-copy), UI de tablas y reglas de turno/fecha.

## Subcapas internas

| Path           | Rol                                                      |
| -------------- | -------------------------------------------------------- |
| `components/`  | UI del censo (tabla, filas, modales, secciones)          |
| `hooks/`       | Orquestación de estado y acciones de la feature          |
| `controllers/` | Lógica pura (validación, mapping, ejecución de comandos) |
| `domain/`      | Contratos de movimientos y reglas propias                |
| `context/`     | Contextos internos de acciones de censo                  |
| `types/`       | Tipos internos del módulo                                |
| `validation/`  | Validaciones específicas de acciones de censo            |

## Flujos críticos

### Acción de movimiento

```text
UI modal -> use*ModalForm -> controller validation
-> resolve*Command -> execute*RuntimeCommand
-> actions DailyRecord -> persistencia
```

### Reglas de fecha/turno

```text
clinicalShiftCalendarController
  -> bounds (recordDate / nextDay / nightEnd)
  -> validation (movementDate + movementTime)
  -> presentation (dateLabel + timeLabel)
```

## Archivos clave

| Archivo                                                  | Motivo                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| `controllers/clinicalShiftCalendarController.ts`         | Fuente única de invariantes de fecha/turno |
| `controllers/censusActionExecutionController.ts`         | Resolución de comandos tipados             |
| `controllers/censusActionRuntimeController.ts`           | Ejecución runtime desacoplada de provider  |
| `controllers/patientMovementCommandRuntimeController.ts` | Bridge command -> action runtime           |
| `hooks/useDischargeModalForm.ts`                         | Form flow de altas                         |
| `hooks/useTransferModalForm.ts`                          | Form flow de traslados                     |

## Calidad

- Cobertura alta en `src/tests/views/census/**`.
- Checks de arquitectura y boundaries runtime en CI local (`check:quality`).
