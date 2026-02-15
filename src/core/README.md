# `src/core`

## Propósito

Núcleo reusable para primitivas de UI y servicios base desacoplados de features.

## Mapa

| Path             | Propósito                                     |
| ---------------- | --------------------------------------------- |
| `ui/`            | Primitivas (`Button`, `Input`, `Modal`, etc.) |
| `services/`      | Espacio para contratos/servicios core         |
| `value-objects/` | Value objects transversales                   |

## Archivos destacados (`core/ui`)

| Archivo      | Propósito          |
| ------------ | ------------------ |
| `Button.tsx` | Botón base         |
| `Card.tsx`   | Contenedor UI base |
| `Input.tsx`  | Input base         |
| `Modal.tsx`  | Modal base         |
| `Select.tsx` | Select base        |
| `index.ts`   | Barrel export      |

## Patrón

- Design primitives de bajo acoplamiento para consumo en features.
