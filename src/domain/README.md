# `src/domain`

## Propósito

Lógica de dominio transversal independiente de UI/framework.

## Archivos

| Archivo            | Propósito                                                      |
| ------------------ | -------------------------------------------------------------- |
| `CensusManager.ts` | Reglas de dominio y validación de acciones de censo/movimiento |

## Patrón

- Dominio puro y reusable desde hooks/controllers.

## Ejemplo

```ts
const validation = CensusManager.validateMovement(actionState, record);
```
