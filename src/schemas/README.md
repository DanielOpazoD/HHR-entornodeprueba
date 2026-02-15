# `src/schemas`

## Propósito

Definir validaciones estructurales y contratos de entrada con Zod.

## Archivos

| Archivo           | Propósito                                |
| ----------------- | ---------------------------------------- |
| `inputSchemas.ts` | Esquemas de formularios/inputs           |
| `zodSchemas.ts`   | Esquemas amplios de entidades y payloads |
| `index.ts`        | Barrel export                            |

## Patrón

- Validación temprana de datos de borde (UI/API/storage).
- Alineación con `src/types` para consistencia estática + runtime.

## Ejemplo

```ts
import { dailyRecordSchema } from '@/schemas';
```
