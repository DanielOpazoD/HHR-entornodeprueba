# `src/utils`

## Propósito

Helpers puros reutilizables (sin estado global ni efectos de UI).

## Mapa de archivos

| Archivo                | Propósito                                      |
| ---------------------- | ---------------------------------------------- |
| `arrayUtils.ts`        | Helpers de arreglos                            |
| `bedTypeUtils.ts`      | Utilidades de tipo de cama                     |
| `csvUtils.ts`          | Parsing/serialización CSV                      |
| `dateUtils.ts`         | Fechas, turnos, formateo y reglas temporales   |
| `integrityGuard.ts`    | Guardas de integridad de datos                 |
| `jsonUtils.ts`         | Operaciones JSON seguras                       |
| `networkUtils.ts`      | Helpers de conectividad/red                    |
| `optimisticUpdates.ts` | Utilidades para updates optimistas             |
| `patchUtils.ts`        | Aplicación de patches parciales                |
| `permissions.ts`       | Reglas de permisos por rol/módulo              |
| `publicCensusToken.ts` | Construcción/validación de token censo público |
| `recordInvariants.ts`  | Invariantes de registro                        |
| `rutUtils.ts`          | Validación/formateo de RUT                     |
| `stringUtils.ts`       | Helpers de string                              |
| `index.ts`             | Barrel export                                  |

## Patrón

- Funciones determinísticas y testeables en aislamiento.
