# `src/`: código fuente

Todo el código de la aplicación web vive aquí, repartido por capas: núcleo puro (`types/`,
`domain/`, `utils/`, `constants/`, `schemas/`), servicios (`services/`), casos de uso y puertos
(`application/`), estado React compartido (`hooks/`, `context/`), UI compartida
(`components/`), áreas del producto (`features/`) y composición (`app-shell/`, `views/`,
`App.tsx`, `index.tsx`). Las pruebas unitarias viven en `tests/`.

Qué capa puede depender de cuál, quién es dueño de cada concepto y dónde va algo nuevo lo dice
la [página de arquitectura](../docs/architecture.md). Los README de cada carpeta solo dicen qué
va en ella; para listar archivos, usa el árbol (`git ls-files src/<carpeta>`), no una tabla.
