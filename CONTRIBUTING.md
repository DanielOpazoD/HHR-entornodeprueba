# Contribuir a HHR

Antes de crear una capa, módulo o dependencia, comprobar si el problema se resuelve
eliminando, unificando o simplificando una implementación existente. El objetivo es
preservar el comportamiento con menos caminos y responsabilidades explícitas.

## Preparar el entorno

El runtime declarado en `package.json` es Node **22.x**. Usar el lockfile vigente:

```sh
git clone https://github.com/DanielOpazoD/HHR-entornodeprueba.git
cd HHR-entornodeprueba
npm ci
cp .env.example .env.local
npm run dev
```

Completar el entorno local autorizado según `.env.example`; no copiar valores a
commits, logs ni PR. Confirmar proyecto Firebase y destino antes de una prueba que
escriba datos. Un servidor localhost no implica una base de pruebas.

No incorporar datos reales de pacientes en commits, fixtures, logs, capturas,
issues ni evidencia de PR. Usar datos sintéticos en tests y muestras compartidas;
los archivos clínicos/HAR autorizados para diagnóstico permanecen privados y fuera
del repositorio. No compartir credenciales ni otros datos sensibles.

Si la instalación falla, corregir el error y repetir `npm ci`. No eliminar el
lockfile ni actualizar todo el grafo para intentar reparar un fallo local.
Functions tiene su propio manifest y lockfile en `functions/`; tratarlo por separado.

## Elegir dónde cambiar

Consultar [arquitectura](docs/architecture.md) y
[Codebase Canon](docs/CODEBASE_CANON.md), luego el README del módulo afectado.

- Preferir el dueño y camino existentes. Un wrapper sin validación, coordinación o
  contrato propio no justifica otro módulo.
- Una lógica usada por una sola feature permanece en ella. Promoverla a `shared`
  sólo cuando exista reutilización real y semántica común.
- Consumidores externos usan la API pública de la feature. Los adapters de servicios
  concretos pertenecen al límite permitido, sin abrir imports de storage desde UI.
- Preservar APIs públicas y lectores históricos. Código aparentemente antiguo puede
  proteger datos, permisos o sesiones todavía válidos.
- Memoizar sólo cuando la identidad o el coste importe a un consumidor demostrado.
  No usar `useCallback` o `useMemo` como requisito universal.

## Iterar y probar comportamiento

```sh
git switch -c codex/descripcion-del-cambio
npx vitest run src/tests/ruta/suite.test.ts
npm run check:quality:group -- boundaries
```

Elegir el grupo de calidad correspondiente: `boundaries`, `governance`, `security`,
`size`, `tests` o `reports`. `npx vitest run <ruta>` ejecuta una suite;
`npm test` ejecuta unitarios, reglas y sincronización con emulador. Sus argumentos
no son intercambiables.

Antes de añadir tests, revisar los existentes. Conservar casos que distingan
resultados clínicos, autoridad, concurrencia, fallos y compatibilidad. Fusionar
setup compartido sin compartir estado mutable entre casos. Retirar sólo pruebas
cuyo comportamiento haya desaparecido o esté cubierto de forma equivalente;
no medir calidad por cantidad de casos ni por un porcentaje inventado para esta guía.

Probar el efecto observable, no que el código llame a otro wrapper. Evitar mocks
por encima del comportamiento que se intenta verificar. Una prueba con loader
mockeado no acredita recuperación de módulos en un navegador real.

## Cerrar y publicar

La política y los comandos de cierre viven en
[Safe Change Checklist](docs/SAFE_CHANGE_CHECKLIST.md),
[Definition of Done](docs/ENGINEERING_DEFINITION_OF_DONE.md) y
[CI y recuperación](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md).
Clasificar el cambio y ejecutar el gate correspondiente; las pruebas focalizadas
no lo sustituyen. `ci:pre-merge` contiene tipos, lint, calidad y unitarios;
`ci:merge-gate` añade cobertura crítica, funciones, build y preview. No repetir
sus componentes sobre el mismo diff salvo fallo o nueva incertidumbre.

```sh
npm run ci:merge-gate
git diff --check
git add ruta/del/archivo
git commit -m "refactor(area): simplificación concreta"
git push -u origin codex/descripcion-del-cambio
```

El hook de commit comprueba tipos, secretos y archivos staged; no saltarlo.
Para cambios críticos, aplicar también los controles adicionales de su categoría.

El PR debe explicar problema, comportamiento resultante, alcance, evidencia,
riesgos y reversión. Revisar el diff final de forma independiente. Antes del merge,
verificar el SHA exacto, CI, conflictos y observaciones accionables. Una CI pendiente
no está aprobada. Tras el merge, comprobar `main` y su evidencia posterior.

Actualizar el documento dueño de la decisión y sus enlaces. No duplicar una nueva
versión del mismo contrato en varias guías. Git conserva el código y documentación
retirados; no crear otro archivo histórico sólo para conservarlos.
