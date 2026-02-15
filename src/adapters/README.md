# `src/adapters`

## Propósito

Capa reservada para adaptadores de integración entre APIs externas y contratos internos de la app.

## Mapa

| Path     | Tipo       | Propósito                                                 |
| -------- | ---------- | --------------------------------------------------------- |
| `react/` | Directorio | Adaptadores específicos para React (espacio en evolución) |

## Patrones

- Adapter Pattern para desacoplar librerías externas de contratos internos.
- Boundary explícito para facilitar reemplazos tecnológicos.

## Nota

Actualmente esta capa es liviana; cuando se agreguen adaptadores nuevos, documentar aquí:

1. contrato de entrada/salida,
2. dependencia externa,
3. estrategia de test.
