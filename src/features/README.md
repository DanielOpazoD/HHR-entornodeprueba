# `src/features`

Una carpeta por área del producto, con todo lo que esa área usa sola: pantallas, hooks,
controladores, reglas, servicios y tipos. Lo que también usa otra área pasa a una capa
compartida. Un área se consume desde fuera solo por su `public.ts`, su `index.ts` o una
entrada liviana declarada en `publicModulesByFeature` de
[`scripts/feature-dependency-matrix.json`](../../scripts/feature-dependency-matrix.json), y solo
si la matriz lo permite; ESLint lo impone. Dentro del área se usan imports relativos.

Qué hace cada área para el hospital, cómo se organiza por dentro y dónde va cada cosa:
[arquitectura](../../docs/architecture.md), sección «Áreas».
