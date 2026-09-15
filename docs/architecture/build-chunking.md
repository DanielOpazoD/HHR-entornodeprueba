# Build Chunking

## Purpose

- Keep production chunking predictable and safe for Netlify/Vite deploys.
- Prevent production-only initialization failures caused by cross-chunk import cycles.

## Current policy

- The source of truth for manual chunk classification is [scripts/config/chunkingPolicy.ts](../../scripts/config/chunkingPolicy.ts).
- [vite.config.ts](../../vite.config.ts) consumes that policy directly instead of duplicating chunk rules inline.

## Important guardrail

- Do not create a dedicated manual chunk for `shared-census` storage modules while they still share imports with `feature-backup-storage`.
- This previously produced a production-only cycle between `feature-shared-census-storage` and `feature-backup-storage`, which crashed Netlify with `Cannot access '<symbol>' before initialization`.

## Safe chunking rule

- Group tightly coupled backup/storage modules under `feature-backup-storage` unless they have a proven isolated runtime boundary.
- Only split a new manual chunk when:
  - the module graph is one-directional,
  - the feature can initialize without importing back into the parent chunk,
  - the production build is validated after the change.

## Feature-oriented loading strategy

- Ya no se fuerzan manual chunks para módulos de `src/`.
- Vite conserva el lazy loading natural definido por los entrypoints dinámicos, pero evita fijar fronteras artificiales entre módulos de aplicación que comparten imports transversales.
- Este cambio se tomó después de detectar un ciclo productivo entre `vendor-react`, `feature-clinical-documents` y `feature-census-runtime` que dejaba `React.createContext` como `undefined` durante la evaluación temprana de módulos en Netlify.
- Si en el futuro se quiere reintroducir un manual chunk para código de aplicación, primero hay que demostrar que el grafo es estrictamente unidireccional y validar que ningún chunk vendor importe de vuelta un chunk de feature.

## Vendor strategy

- `vendor-firebase-core`: `firebase/app`, `firebase/auth` y módulos base acoplados al arranque.
- `vendor-firebase-aux`: Storage, conservado en el precache para que los módulos que presentan adjuntos puedan cargar su runtime aun cuando la conectividad se degrade.
- `vendor-firebase-functions`: callable Functions, aislado y fuera del precache porque toda invocación requiere red. El chunk mantiene un presupuesto propio y vuelve a descargarse bajo demanda.
- `vendor-firebase-firestore`: Firestore queda separado del core, pero no se debe separar `auth` del core mientras ambos sigan importándose mutuamente en el bundle generado.
- `vendor-pdf` y `vendor-excel-*`: la generación documental y exportaciones deben seguir siendo capacidades lazy y aisladas del shell principal.

## Validation

- Run `npm run build` after any `manualChunks` change.
- Run `npm run check:bundle-budget` and watch startup chunk warnings, not only hard failures.
- Run `npm run check:chunk-graph` to guarantee no vendor↔vendor or vendor→feature cycles.
- Run `npm run test:e2e:preview:census-bootstrap:built` after the build when the change touches startup, Firebase or lazy-loading seams.
- Run the focused test `vitest run src/tests/build/chunkingPolicy.test.ts`.
- Inspect the built assets and confirm there is no two-way import between runtime chunks, especially any `vendor-*` chunk importing back into a feature chunk.

## Firebase update boundary

- Firebase 12.14.0 es el último minor validado dentro de los presupuestos actuales. Incluye el reintento de disponibilidad de IndexedDB en Auth y mejoras de robustez del listen stream de Firestore.
- Firebase 12.15.0 y posteriores incorporan `re2js` en Firestore. En la medición local de 12.19.0, `vendor-firebase-firestore` creció de aproximadamente 402 KB a 594 KB y superó tanto su presupuesto dedicado como el límite de precache.
- No subir el límite ni excluir Firestore del precache para aceptar ese crecimiento: Firestore forma parte del runtime clínico offline. Reintentar el upgrade cuando el SDK permita eliminar ese código mediante tree shaking o cuando una actualización reduzca el chunk dentro de los límites vigentes.
