# `src/shared`

Piezas transversales reales: contratos puros (`contracts/`, por ejemplo `ApplicationOutcome` y
los contratos HTTP con Netlify en `contracts/serverless.ts`), adaptadores del navegador
(`runtime/browserWindowRuntimeCore.ts` y `runtime/browserClipboardRuntime.ts`; cada adaptador
se importa desde su propio archivo), permisos (`access/`) y ayudas de presentación usadas por
más de un módulo. No es dueña de tipos del dominio, que viven en `src/types/domain`, ni un
lugar para código sin dueño claro: lo que usa una sola área va en esa área.

Dueños, puertas y el objetivo de repartir esta carpeta: [arquitectura](../../docs/architecture.md).
