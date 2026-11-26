# Especificacion de Fronteras por Dominio (Cimientos)

Fecha: 2026-04-20  
Estado: Activo (base para enforcement incremental)

## Objetivo

Definir fronteras claras de dependencia para reducir acoplamiento, facilitar testeo y evitar regresiones estructurales.

## Dominios alcanzados

- `census`
- `handoff`
- `cudyr`
- `exporters`
- `layout` (shell transversal)

## Matriz de dependencias permitidas (objetivo)

| Desde                    | Puede importar                                                                       | No debe importar                                       |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `features/*/components`  | `features/*/controllers`, `features/*/contracts`, `shared/*`, `application/*`        | `services/repositories/*`, `services/infrastructure/*` |
| `features/*/controllers` | `features/*/contracts`, `services/*` (solo contratos/servicios estables), `shared/*` | `components/*`                                         |
| `components/layout/*`    | `components/layout/controllers`, `shared/*`, `application/*`                         | `services/repositories/*`, `services/infrastructure/*` |
| `services/exporters/*`   | `services/exporters/excel/*`, `services/*` utilitarios, `shared/*`                   | imports de UI/feature                                  |
| `application/*`          | `application/ports/*`, `services/*` via puertos/adaptadores                          | dependencia directa de componentes UI                  |

## Reglas de inicio (enforcement incremental)

Se aplican de inmediato en zonas limpias:

- `src/features/cudyr/**/*`
- `src/features/handoff/**/*`
- `src/components/layout/**/*`

Bloqueo activo:

- `@/services/repositories/*`
- `@/services/RepositoryContext`
- `@/services/infrastructure/*`

## Deuda estructural explicitada (siguiente ola)

Zonas con acoplamiento legacy que se migran en T03/T04:

- `src/hooks/**` (varios imports directos a repositorios y contratos de repos)
- `src/features/census/components/global-search/**` (imports dinamicos directos a repositorios)

## Criterio de exito de esta fase

1. Existe una referencia canonica de boundaries por dominio.
2. El lint bloquea nuevas violaciones en dominios ya estabilizados.
3. Se mantiene CI verde sin introducir ruptura masiva por deuda legacy previa.
