# Preservar los PDF originales de enfermería

```sh
GCLOUD_BIN=/opt/homebrew/share/google-cloud-sdk/bin/gcloud node scripts/migration/nursingOriginals.mjs
npx vitest run src/tests/build/migrationNursingOriginals.test.ts
```

Solo consulta metadatos de `entregas-enfermeria/` en los dos buckets Firebase
identificados por proyecto. No descarga PDF, no cambia permisos, no copia objetos
y no modifica las entregas estructuradas. Requiere Node 24 y acceso de lectura.
La salida contiene identificadores opacos, estados y cantidades, sin rutas ni nombres.

La revisión inicial encontró 213 archivos antiguos y 138 en pruebas; los diez con
ruta coincidente tenían contenido distinto. Son cifras históricas, no constantes
ni metas del programa. Hay que consultar de nuevo antes de cada lote.

Se enumeran también las generaciones no vigentes que conserve el bucket antiguo.
Cada generación original se propone en una ruta nueva:
`entregas-enfermeria/originales-antiguo/<huella de bucket+ruta+generación>.pdf`.
Una nueva generación obtiene otra ruta. Los PDF actuales de pruebas se conservan,
aunque su ruta coincida con el antiguo. No se deduplican por nombre ni por tamaño.

Las propuestas en memoria llevan generación origen, MD5 del proveedor, tamaño y
precondiciones de copia: generación exacta de origen y destino inexistente
(`ifGenerationMatch=0`). Si ya existe el archivo archivado con contenido diferente
o no verificable, se detiene ese caso. Sin checksum fuente, también queda en revisión.
Un checksum coincidente compara contenido; no prueba identidad clínica ni turno.

`proposals` contiene rutas privadas: no imprimirlo ni guardarlo en Git. Una futura
herramienta de copia deberá releer las generaciones, ejecutar ambas precondiciones,
verificar el contenido guardado y conservar un recibo privado por objeto. Las
consultas de este plan no son una instantánea transaccional y el plan no autoriza
ni ejecuta esa copia. Antes de integrar acceso a estos originales en la aplicación
habrá que comprobar permisos con los roles existentes; este PR no amplía reglas.
