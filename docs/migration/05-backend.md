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

También enumera todas las funciones, en todas las regiones del proyecto antiguo,
y detecta los nombres que comienzan por `mirror`, sin distinguir mayúsculas.
Eliminar solo `mirrorDailyRecords` no acredita que hayan desaparecido los espejos
de ajustes, documentos, auditoría o traslados. Una familia vacía comprobada se
informa como `deleted`; cualquier espejo presente, incluso con errores u offline,
sigue pendiente y aparece en `remainingFunctions`.

Si gcloud advierte de regiones inaccesibles o emite otros diagnósticos, el inventario
se considera incompleto y la consulta falla. La salida versión 2 declara
`function: "mirror*"` y `scope: "all-regions-all-mirror-functions"`. El preflight
requiere esta cobertura, `state: "deleted"` y `remainingFunctions: []`; un informe
anterior que solo verificó el censo no sirve para acreditar la retirada completa.
No se debe recrear ninguna función para cumplir el control.

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

## Límites de acceso que deben conservarse en la publicación

Las plantillas de indicaciones pertenecen a su usuario: puede borrarlas sin
reenviar contenido. Una indicación archivada vincula su identificador con el
documento y su autor con la sesión; si informa rol, debe ser el rol efectivo.
Los registros antiguos pueden omitir ese rol. El archivo sigue siendo inmutable.

En recetas fotografiadas, Enfermería puede corregir la asignación de paciente y
el tipo de receta, con la identidad del funcionario que modifica esos campos.
No puede sustituir la imagen original, su ruta ni su autor de carga.
Las correcciones requieren actualizar su fecha; no reutilizan la del comando
anterior. Confirmar nuevamente la misma asignación sigue permitido con fecha
nueva y el funcionario autenticado, como admite el diálogo vigente.
Se conservan la eliminación manual ya habilitada para Enfermería y el mantenimiento por un
administrador. No confundir esos permisos con una publicación de reglas.

La suite de emulador verifica ambos lados: operaciones legítimas y rechazo de
sustitución de fuente o autor. Los registros clínicos de esquema 2 conservan la
autoridad del servidor también en los modos off y shadow. Estos cambios no
modifican los permisos existentes para finalizar o corregir traslados.
