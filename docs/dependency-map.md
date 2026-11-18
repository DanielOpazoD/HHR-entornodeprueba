# Dirección entre carpetas de `src/`

La regla es una sola y vive en dos archivos:

- `../scripts/folder-dependency-matrix.json`: la capa de cada carpeta de primer nivel de `src/`
  (y de los archivos directos de `src/`, «(raíz)») y el libro de excepciones.
- `../scripts/check-folder-dependencies.mjs`: el control (`npm run check:folder-dependencies`).

## La regla

- Un módulo depende solo de su capa o de las de abajo, del núcleo puro (0) a la composición (6).
- Obliga a las referencias que ejecutan código: imports de valor, reexportaciones, imports sin
  nombres, `import()` y `new URL('x', import.meta.url)` (workers). Cualquier grafía cuenta:
  alias `@/`, relativa, con o sin extensión.
- Los imports de solo tipos (`import type`, `export type`, `import('x').T`) se borran al compilar
  y pueden cruzar en cualquier dirección.
- Entre features mandan `hhr/feature-boundaries` y `hhr/public-import-boundaries` con
  `../scripts/feature-dependency-matrix.json`, no esta regla.

## El libro de excepciones

Las relaciones hacia arriba que existían cuando se creó la regla están listadas una por una
(archivo origen → archivo destino, clase y motivo) en `exceptions`. El libro solo baja: una
relación nueva hacia arriba falla aunque otra haya desaparecido, y una relación listada que ya no
existe falla hasta que se saca del libro. Agregar una entrada es decisión del responsable.

## Qué hacer cuando falla

El error nombra origen, línea, destino, clase de referencia y la capa de cada uno. Se corrige
moviendo hacia abajo lo que ambos comparten, o llevando a la feature lo que solo usa ella; si
basta el tipo, con `import type`. El control dice «muévelo a la feature» solo cuando esa feature
es el único consumidor del archivo.

## Informe de pertenencia

`node scripts/check-folder-dependencies.mjs --ownership` lista los módulos compartidos que alcanza
una sola feature (contando navegador, worker, Netlify Functions y lo que Functions compila desde
`src/`). Es un informe, no una regla: cada módulo abre una revisión de su dueño.
