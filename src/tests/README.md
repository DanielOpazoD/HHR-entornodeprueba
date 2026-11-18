# `src/tests`

Pruebas unitarias y de integración con Vitest (`*.test.ts`, `*.test.tsx`), organizadas por
capa y por área; las pruebas con emulador viven en `emulator/` y `emulator-ui/`. Cada prueba
verifica lo que observa quien usa el código y usa solo datos sintéticos. De preferencia, la
prueba de `src/X/y.ts` vive en `src/tests/X/` ([arquitectura](../../docs/architecture.md)).

```bash
npx vitest run src/tests/ruta/suite.test.ts
npm run test:changed
npm run test:emulator:file -- src/tests/emulator-ui/suite.emulator-ui.test.ts
```

Las suites de controladores puros pueden correr en Node cuando no necesitan DOM; las de
navegador se quedan en su entorno ([cohortes medidas y comandos](../../docs/testing/NODE_UNIT_SUITES.md)).
Más detalle en [CONTRIBUTING.md](../../CONTRIBUTING.md).
