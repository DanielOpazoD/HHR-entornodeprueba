# Contribuir a HHR

Antes de crear una capa, módulo o dependencia, comprobar si el problema se resuelve
eliminando, unificando o simplificando una implementación existente. El objetivo es
preservar el comportamiento con menos caminos y responsabilidades explícitas.

[AGENTS.md](AGENTS.md) dice qué leer según lo que se toca: un cambio pequeño no exige
recorrer esta guía ni los documentos que enlaza. El [contrato operativo](docs/DOMAIN_RULES.md)
manda en lo clínico; el [glosario](docs/GLOSSARY.md) se consulta por término.
En cambios de flujo, indicar las reglas afectadas y los ejemplos de comportamiento
que deben conservarse. Si una regla necesita cambiar, registrar primero la decisión
explícita del responsable del producto; no deducirla de un refactor o de un error existente.

La [guía operativa navegable](docs/guia-operativa.html) reúne fuentes, escenarios y
estados de implementación. El contrato es canónico; la guía no sustituye sus reglas
ni demuestra por sí sola que el código o el despliegue las cumplan.

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

Dónde va cada cosa, qué capa puede depender de cuál y quién es dueño de cada concepto lo
dice la [página de arquitectura](docs/architecture.md); no se repite aquí. Además:

Memoizar sólo cuando la identidad o el coste importe a un consumidor demostrado. No usar
`useCallback` o `useMemo` como requisito universal.

## Iterar y probar comportamiento

```sh
git fetch origin main
git switch -c codex/descripcion-del-cambio --no-track origin/main
npx vitest run src/tests/ruta/suite.test.ts
npm run test:changed
npm run test:emulator:file -- src/tests/emulator-ui/suite.emulator-ui.test.ts
npm run check:quality:group -- boundaries
```

La rama parte de `origin/main` recién traído: un worktree puede estar varios commits atrás.
`npx vitest run <ruta>` ejecuta una suite. `npm run test:changed` ejecuta las pruebas
unitarias que alcanzan lo cambiado por imports, también a través de un `index.ts`; una
prueba que solo nombra el módulo en `vi.mock` puede quedar fuera. Si cambia lo que carga cada
prueba (`vitest.config.ts` y lo que importa, `tsconfig.json`, `package.json`, el lockfile o
`src/tests/setup.ts` y sus imports), ejecuta la suite unitaria completa y lo avisa.
`npm run test:emulator:file -- <ruta>` levanta el emulador con puertos libres para uno o
varios archivos de `src/tests/emulator/` o `src/tests/emulator-ui/`, de modo que dos
worktrees pueden correr a la vez. `npm test` ejecuta unitarios, reglas y sincronización con
emulador. Sus argumentos no son intercambiables. Elegir el grupo de calidad
correspondiente: `boundaries`, `governance`, `security`, `size`, `tests` o `reports`.

Un arreglo de defecto empieza por una prueba que falla en `main` por ese motivo; si el
defecto no se reproduce, no hay arreglo que hacer. Quitar el arreglo debe volver a ponerla
en rojo.

`src/tests/setup.ts` simula `@/application/ports/dailyRecordPort` para todas las pruebas.
Una prueba que necesita el puerto y el repositorio reales lo declara con
`vi.unmock('@/application/ports/dailyRecordPort')`; sin eso la prueba falla sin nombrar
la causa.

Antes de añadir tests, revisar los existentes. Conservar casos que distingan
resultados clínicos, autoridad, concurrencia, fallos y compatibilidad. Fusionar
setup compartido sin compartir estado mutable entre casos. Retirar sólo pruebas
cuyo comportamiento haya desaparecido o esté cubierto de forma equivalente;
no medir calidad por cantidad de casos ni por un porcentaje inventado para esta guía.

Probar el efecto observable, no que el código llame a otro wrapper. Evitar mocks
por encima del comportamiento que se intenta verificar. Una prueba con loader
mockeado no acredita recuperación de módulos en un navegador real.

## Cerrar y publicar

Antes de subir, `npm run check:changed` corre los controles formales sobre lo cambiado
(también lo hace el gancho `pre-push`). Documento de consulta, no de lectura previa:
[CI, cierre y recuperación](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md) para cobertura de un cambio
crítico (guardado, reglas, despliegue), definición de terminado o cuando un control falla.
Clasificar el cambio y acreditar los controles correspondientes con CI del SHA final;
no se exige repetirlos localmente. Comprobar el alcance ejecutado y conservar el enlace
al run y sus artefactos. Ejecutar localmente las regresiones durante la edición y sólo
las comprobaciones adicionales que CI no cubra. Las pruebas focalizadas solas no
sustituyen CI; `ci-summary` en GitHub acredita tipos, lint, calidad, unitarios,
cobertura crítica, funciones, build, preview, emuladores y E2E críticos. No repetir
sus componentes sobre el mismo diff salvo fallo o nueva incertidumbre.

El hook de commit formatea y ejecuta ESLint sobre los archivos de código preparados
para el commit, sin admitir advertencias. Después comprueba tipos y secretos.
La comprobación local de tipos usa `npm run typecheck:local` y conserva su caché en
`output/typecheck/` dentro del worktree; borrarla es seguro. CI sigue usando
`npm run typecheck`, que comprueba los tres proyectos (`tsconfig.json`, `tsconfig.netlify.json`
y `functions/tsconfig.json`) desde cero.
`check:unchecked-index` también reutiliza localmente su propia caché
`output/typecheck/unchecked-index.tsbuildinfo`; con `CI` definido y al escribir la línea base
(`--write-baseline`) compila desde cero. Si su resultado local difiere del de CI, borra ese archivo.
Respeta los archivos excluidos por la configuración de ESLint y no modifica sus reglas.
El lint focalizado permite detectar antes errores como un `setState` síncrono en un
efecto de React; el CI completo sigue siendo obligatorio para validar dependencias.

Publicar después de las comprobaciones focalizadas; esperar CI antes del merge:

```sh
git diff --check
git add ruta/del/archivo
git commit -m "refactor(area): simplificación concreta"
git push -u origin codex/descripcion-del-cambio
```

El hook de commit comprueba tipos, secretos y archivos staged; no saltarlo.
Los gates locales completos quedan disponibles para diagnóstico o cobertura que
falte en CI. Para cambios críticos, verificar también los controles de su categoría.

El PR debe explicar problema, comportamiento resultante, alcance, evidencia,
riesgos y reversión. Revisar el diff final de forma independiente. Antes del merge,
verificar el SHA exacto, CI, conflictos y observaciones accionables. Una CI pendiente
no está aprobada. Tras el merge, comprobar `main` y su evidencia posterior: si su árbol
es el que probó la PR, su `ci-summary` nombra esa corrida en vez de repetirla
([CI y recuperación](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md)).

Actualizar el documento dueño de la decisión y sus enlaces. No duplicar una nueva
versión del mismo contrato en varias guías. Git conserva el código y documentación
retirados; no crear otro archivo histórico sólo para conservarlos.

El historial (planes ejecutados, auditorías fechadas) está en `docs/archive/`; no es norma vigente y las búsquedas lo omiten. `rg --no-ignore` para incluirlo.
