# `src/shared`

## Propósito

Utilidades y contratos transversales compartidos entre múltiples capas/features.

## Mapa

| Path                              | Propósito                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `runtime/browserWindowRuntime.ts` | Adapter para efectos browser (`alert`, `confirm`, `open`, `reload`, `localStorage`) |
| `ui/anchoredOverlayTypes.ts`      | Tipos de overlays/posicionamiento reutilizables                                     |

## Patrón

- Runtime Adapter Pattern para reducir acoplamiento directo a APIs globales del navegador.

## Ejemplo

```ts
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';
defaultBrowserWindowRuntime.alert('Mensaje');
```
