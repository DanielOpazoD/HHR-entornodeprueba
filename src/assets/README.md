# `src/assets`

## Propósito

Contenedor para recursos estáticos internos del bundle (si no van en `public/`).

## Estado actual

| Path          | Estado    | Comentario                          |
| ------------- | --------- | ----------------------------------- |
| `src/assets/` | Reservado | Actualmente sin archivos de runtime |

## Criterio de uso

- Usar `public/` para recursos estáticos sin fingerprint del bundler.
- Usar `src/assets/` para recursos importados desde código (`import img from ...`).
