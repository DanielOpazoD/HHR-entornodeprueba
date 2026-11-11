# `src/views`

## Propósito

Composición y lazy loading de vistas de alto nivel (módulos de navegación).

## Archivos

| Archivo        | Propósito                                                    |
| -------------- | ------------------------------------------------------------ |
| `LazyViews.ts` | Importaciones lazy por módulo (Census, Handoff, Admin, etc.) |

## Patrón

- Code splitting por módulo para reducir bundle inicial.

## Ejemplo

```ts
const CensusView = lazy(() => import('@/features/census').then(m => ({ default: m.CensusView })));
```
