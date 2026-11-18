# `src/components`

UI compartida por más de un área: el armazón (`layout/`), los modales transversales
(`modals/`), las primitivas (`ui/`) y piezas comunes como `shared/BaseModal.tsx` y los límites
de error (`GlobalErrorBoundary`, `SectionErrorBoundary`). Un componente que usa una sola área va
en esa área; los componentes no leen ni escriben datos por repositorios, y los efectos del
navegador (`alert`, `open`, portapapeles) pasan por los adaptadores de `shared/runtime`
(regla `browser-runtime-adapter` del control de patrones de `src/`, en `check:quality`).

Qué puede importar esta carpeta y dónde va cada cosa: [arquitectura](../../docs/architecture.md).
