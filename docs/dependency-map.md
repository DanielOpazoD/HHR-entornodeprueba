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
- La interfaz compartida no abre datos: `components/` no carga (en valor ni diferido) un módulo de
  `services/` que importe Firestore, Storage o Dexie, o use el global `indexedDB`, directamente o
  a través de otros módulos de `services/` (`dataAccess` en la matriz). El acceso a datos está
  repartido en muchas carpetas de servicios junto a ayudas puras, por eso se reconoce por lo que
  el módulo importa y no por su carpeta. La lectura o escritura sube a un hook, un contexto o la
  feature que la usa.
- Vite y el control resuelven igual: `@/` es `src/`, `/src/…` es la raíz, `./x.js` puede ser
  `./x.ts`, y una consulta (`?worker`, `?url`, `?raw`, `?inline`) nombra el mismo archivo y cuenta
  como carga diferida.
- Entre features mandan `hhr/feature-boundaries` y `hhr/public-import-boundaries` con
  `../scripts/feature-dependency-matrix.json`, no esta regla.

## El libro de excepciones

Las relaciones que existían cuando se creó cada regla están listadas una por una (archivo origen
→ archivo destino, clase y motivo): las que suben en `exceptions` y las lecturas de datos de la
interfaz compartida en `dataAccess.exceptions`. El libro solo baja:

- una relación nueva falla aunque otra haya desaparecido, y una relación listada que ya no existe
  falla hasta que se saca del libro;
- el libro de un cambio no puede tener una entrada que no esté en el de su base, ni siquiera a
  cambio de otra que se quitó. La base es `FOLDER_BOOK_BASE` (CI pasa la de la PR) o
  `git merge-base HEAD origin/main`; sin base, el control avisa y no compara.

Agregar una entrada es decisión del responsable, en su propia PR.

## Qué hacer cuando falla

El error nombra origen, línea, destino, clase de referencia y la capa de cada uno. Se corrige
moviendo hacia abajo lo que ambos comparten, o llevando a la feature lo que solo usa ella; si
basta el tipo, con `import type`. El control dice «muévelo a la feature» solo cuando esa feature
es el único consumidor del archivo.

## Informe de pertenencia

`node scripts/check-folder-dependencies.mjs --ownership` lista los módulos compartidos que alcanza
una sola feature (contando navegador, worker, Netlify Functions y lo que Functions compila desde
`src/`). Es un informe, no una regla: cada módulo abre una revisión de su dueño.
