# `src/config`

## Propósito

Configuración transversal de librerías de infraestructura de aplicación.

## Archivos

| Archivo          | Propósito                                                                 |
| ---------------- | ------------------------------------------------------------------------- |
| `queryClient.ts` | Configura `@tanstack/react-query` (`queryKeys`, defaults, cache behavior) |

## Patrón

- Config centralizada y reusable para evitar settings duplicados por hook.

## Ejemplo

```ts
import { queryClient } from '@/config/queryClient';
```
