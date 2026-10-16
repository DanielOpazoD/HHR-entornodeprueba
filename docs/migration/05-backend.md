# Comprobar reglas desplegadas y retirada del espejo

```sh
GCLOUD_BIN=/opt/homebrew/share/google-cloud-sdk/bin/gcloud node scripts/migration/readBackendReadiness.mjs
npx vitest run src/tests/build/migrationBackendReadiness.test.ts src/tests/build/migrationPreflight.test.ts
```

Node 24 y una sesión de gcloud con acceso de lectura a ambos proyectos. Fuera de
macOS, usar la ruta instalada de gcloud o dejar que se resuelva desde PATH.

La herramienta verifica los números de proyecto, consulta la versión publicada de
las reglas Firestore de `hhr-pruebas` y compara su SHA-256 con `firestore.rules` del
checkout. Relee la publicación al terminar: si cambió, la comparación no queda
validada. No imprime reglas, credenciales, cuentas ni datos clínicos. El proyecto
de cuota de la petición queda explícito; no cambia la configuración de gcloud.

También enumera la función exacta `mirrorDailyRecords` en el proyecto antiguo.
Una lista vacía comprobada se informa como `deleted`; una función presente, incluso
con errores u offline, sigue pendiente. Si gcloud advierte de regiones inaccesibles
o emite otros diagnósticos, el inventario se considera incompleto y la consulta
falla: una respuesta vacía parcial no demuestra eliminación. El preflight acepta evidencia reciente de
un espejo eliminado o deshabilitado. No se debe recrear la función para cumplir
el control de detención.

Código 0: reglas idénticas durante la consulta y espejo eliminado. Código 2:
diferencias o pendientes. Código 1: no se pudo verificar. Un error de permisos no
se interpreta como ausencia. La coincidencia de reglas es solo uno de los controles
de migración: no acredita roles, caché, restauración ni autorización de corte.

No hay `--apply`, copia, creación de reglasets ni publicación. Si existe desfase,
preparar el cambio mínimo revisable, probar roles en emulador y obtener la
correspondiente autorización de despliegue. No publicar todas las reglas de main
solo para resolver una subcolección sin revisar las demás diferencias.

Un error de acceso al visor de conflictos puede deberse a que las reglas
publicadas no contemplan `dailyRecords/{date}/conflictSnapshots/{snapshotId}`.
Renovar sesión no incorpora una regla que falta. Comprobar el despliegue antes
de modificar roles o suavizar el aviso del visor; no sustituir un rechazo de acceso
por «sin conflictos».
