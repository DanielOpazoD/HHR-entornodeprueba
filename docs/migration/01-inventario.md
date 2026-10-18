# Inventario previo a la migración

Antes de ejecutar este procedimiento, aplicar la [política vigente de fuentes y
alcance](00-fuentes-y-alcance.md). Las herramientas descritas conservan sus límites;
no autorizan reabrir censos cerrados ni sobrescribir correcciones.

La base será `hhr-pruebas`. Se conserva su censo corregido y el CUDYR oficial de
agosto y septiembre. El antiguo aporta información que debe cotejarse; una
diferencia de campos no autoriza sustituir el documento del día.

```sh
GCLOUD_BIN=/opt/homebrew/share/google-cloud-sdk/bin/gcloud node scripts/migration/readInventory.mjs --out /tmp/hhr-inventario-nuevo.json
npx vitest run src/tests/build/migrationInventory.test.ts
```

Requiere Node 24 y una sesión de gcloud con permiso de lectura en ambos proyectos.
En otros equipos, usar `gcloud` en PATH u otra ruta en `GCLOUD_BIN`.
No hay `--apply`, escrituras remotas ni cambio de proyecto activo de gcloud.
Se comprueban los números de proyecto antes de consultar y se rechazan redirects.

El informe contiene fechas, cantidades, huellas del día y versiones; no nombres,
RUT, notas clínicas ni tokens. El archivo se crea con permisos 0600 y no reemplaza
uno existente. Sigue siendo información operativa: conservarlo fuera del repositorio.

Se vuelve a leer la versión de todos los censos y del CUDYR protegido al terminar.
Código 0: ventana estable; 2: cambió algún documento o falta evidencia del CUDYR;
1: no se pudo completar la consulta. Una ventana estable permite **planificar**;
no constituye una transacción ni garantiza que los datos no cambien después.

Los marcadores del espejo o de la extensión son pistas de procedencia, no pruebas
de integridad. Los totales cuentan representaciones almacenadas, incluidas cunas
anidadas; no equivalen a pacientes únicos, elegibles ni cumplimiento CUDYR.
Antes de cualquier importación habrá que validar identidad, episodio, ubicación,
turno y versión del documento. Esta herramienta no toma esas decisiones.
