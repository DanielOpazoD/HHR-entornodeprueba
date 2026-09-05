# `src/utils`

## Propósito

Helpers puros reutilizables (sin estado global ni efectos de UI).

## Mapa de archivos

| Archivo                | Propósito                                                   |
| ---------------------- | ----------------------------------------------------------- |
| `bedTypeUtils.ts`      | Utilidades de tipo de cama                                  |
| `csvUtils.ts`          | Parsing/serialización CSV                                   |
| `chileanHolidays.ts`   | Catálogo de feriados chilenos consumido por reglas de turno |
| `dateUtils.ts`         | Fechas, turnos, formateo y reglas temporales                |
| `integrityGuard.ts`    | Guardas de integridad de datos                              |
| `deepClone.ts`         | Clonado profundo tipado para estructuras serializables      |
| `jsonUtils.ts`         | Operaciones JSON seguras                                    |
| `networkUtils.ts`      | Helpers de conectividad/red                                 |
| `optimisticUpdates.ts` | Utilidades para updates optimistas                          |
| `patchUtils.ts`        | Aplicación de patches parciales                             |
| `permissions.ts`       | Reglas de permisos por rol/módulo                           |
| `recordInvariants.ts`  | Invariantes de registro                                     |
| `rutUtils.ts`          | Validación/formateo de RUT                                  |
| `shiftTimeUtils.ts`    | Utilidades simples de ventanas horarias por turno           |
| `stringUtils.ts`       | Helpers de string                                           |
| `index.ts`             | Barrel export                                               |

## Patrón

- Funciones determinísticas y testeables en aislamiento.
- Mantener datasets voluminosos y constantes operativas en archivos dedicados cuando hagan crecer demasiado una utilidad general.
- Cuando una misma presentación temporal se usa en UI y PDF, centralizar el formateo en `dateUtils.ts` para evitar divergencias visuales y de auditoría.
