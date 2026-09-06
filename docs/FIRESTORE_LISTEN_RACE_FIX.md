# Firestore: carrera de suscripciones `ca9` / `b815`

## Diagnóstico y decisión — 6-09-2026

Owner: mantenimiento del runtime Firebase de HHR.
Tipo: `dependency_upgrade`, categoría `firebase_runtime`.
Versión objetivo: `firebase@12.13.0` (exacta, lockfile versionado).
Riesgo: medio; cambia el SDK compartido de Auth/Firestore/Storage/Functions, no el modelo clínico.

El bundle anterior usaba Firestore identificado por el SDK como `12.6.0`.
La prueba de preview reprodujo `ca9` con contador `ve: -1`, seguido de `b815`.
También ocurrió en una copia limpia de main `856dc590`: 1 fallo / 9 ejecuciones.
Por tanto, el fallo no era exclusivo de la recuperación del catálogo de funcionarios.

El proveedor identificó una carrera: al retirar y volver a abrir una escucha,
una respuesta antigua podía aplicarse al nuevo target con el mismo identificador.
El contador de respuestas pendientes quedaba negativo y la cola interna fallaba.
La solución oficial separa los identificadores locales de los remotos y asigna
un identificador remoto nuevo a cada escucha. Se adopta la primera versión estable
que publica esa corrección, sin copiar ni modificar internamente el SDK.

- [Corrección y prueba de regresión del proveedor, PR #9842](https://github.com/firebase/firebase-js-sdk/pull/9842).
- [Notas oficiales, versión 12.13.0](https://firebase.google.com/support/release-notes/js#version_12130_-_may_7_2026).

No se borra IndexedDB, no se desactiva la persistencia multi-tab, no se retrasan
suscripciones artificialmente y no se silencian las excepciones. Los permisos
denegados deben seguir llegando al callback de error, sin inutilizar el cliente.

## Verificación y rollback

La prueba `census-preview-bootstrap.spec.ts` conserva los escenarios existentes
y añade recargas consecutivas con la misma persistencia. Tanto errores de página
como aserciones internas del SDK en consola hacen fallar la prueba; cero retries.

Verificación focalizada: build productivo, preview con `--repeat-each=10`, tests del
bootstrap Firebase y pruebas con Firestore real en emulador. Antes de release:
`ci:release-gate` y `test:release-confidence`, según la política vigente.
La prueba de preview comprueba el arranque local con fixtures; no acredita por sí
sola autenticación real, reglas ni sincronización multiusuario.

Criterio de cierre: la secuencia que fallaba no arroja `ca9`/`b815`, el censo conserva
el registro al recargar y los gates del head que se publique están aprobados.

Rollback: revertir únicamente el cambio de versión y su lockfile como pareja,
reinstalar con `npm ci` y reconstruir. Esto reintroduce el defecto conocido; no es
una solución permanente. No requiere migración ni borrado de datos de usuarios.
