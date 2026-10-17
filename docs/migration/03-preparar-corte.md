# Preparar el cambio de entorno sin hacerlo todavía

La base sigue siendo `hhr-pruebas`; el censo corregido y CUDYR saneado se conservan.
El antiguo es fuente de recuperación selectiva de enfermería y antecedentes. No se
copian documentos completos sobre días ya corregidos ni se rescatan entregas médicas.

## Comprobación reproducible

```sh
node scripts/migration/cutoverPreflight.mjs < /ruta/privada/evidencias.json
npx vitest run src/tests/build/migrationPreflight.test.ts
```

La herramienta no consulta ni modifica la nube. Evalúa evidencias explícitas con
`verifiedAt` en ISO UTC y `evidenceRef` que apunte al comprobante privado revisado.
El reloj debe estar correcto. Cada evidencia vence a las 24 horas y se debe renovar
para un nuevo ensayo. No introduce vencimientos en el sistema clínico.

| Clave          | Evidencia exigida                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`     | `sourceId`, `sourceNumber`, `targetId`, `targetNumber` de `gcloud projects describe`. Números como texto.                                                                                                               |
| `inventory`    | `readWindowStable: true`, `officialCudyrUnchanged: true`, `cloudWrites: 0`, `reportHash` SHA-256 del informe recién obtenido.                                                                                           |
| `mirror`       | Proyecto antiguo, `function: "mirror*"`, `scope: "all-regions-all-mirror-functions"`, `state: "deleted"` y `remainingFunctions: []`. Enumeración completa en todas las regiones; no basta eliminar el espejo del censo. |
| `deployment`   | Proyecto destino, `expectedCommit` y `deployedCommit` completos, iguales y verificados en el despliegue.                                                                                                                |
| `rules`        | Proyecto destino, `expectedHash` y `deployedHash` SHA-256 iguales, cotejando reglas locales y desplegadas.                                                                                                              |
| `localSession` | Proyecto destino, `projectIsolationVerified: true`, `pendingOperations: 0`, Una de las dos estrategias descritas abajo. No basta comparar nombres de sitios.                                                            |
| `access`       | Proyecto destino, `pendingAuthorizations: 0`, `unmappedStaff: 0`, `rolesReviewed: true`. Mantener autores históricos y validar roles; no concederlos por semejanza de nombres.                                          |
| `restore`      | Proyecto destino, `restoreTestPassed: true`, `originalsPreserved: true`, `backupManifestHash` SHA-256. Probar restauración aislada; tener un bucket no basta.                                                           |

Todos los bloques excepto `projects` e `inventory` llevan `project`. El informe
impreso contiene únicamente los estados de los controles; no reproduce referencias,
credenciales, nombres, correos ni datos clínicos. Código 0: evidencias suficientes
para preparar un ensayo; 2: pendientes; 1: entrada inválida. `readyForRehearsal`
no es permiso para un corte ni una verificación independiente de los comprobantes.

La consulta de [backend](05-backend.md) permite cotejar las reglas publicadas y
comprobar que el espejo fue eliminado, sin modificar la nube. Sus resultados se
incorporan a evidencias revisadas; no reemplazan el resto del ensayo.

## Dirección oficial nueva: estrategia elegida

La preparación usa una dirección oficial nueva y conserva temporalmente la antigua
con su Firebase actual. IndexedDB, caché y operaciones locales quedan separados por
origen web. No redirigir la dirección antigua ni cambiarle el Firebase durante este
ensayo; sus operaciones pendientes deben revisarse allí antes de retirarla.

En `localSession` se mantienen `project: "hhr-pruebas"`,
`projectIsolationVerified: true` y `pendingOperations: 0`. Elegir una estrategia:

- **Dirección nueva:** `strategy: "separate-origin"`, `sourceOrigin` y
  `targetOrigin` distintos, escritos como orígenes HTTPS canónicos, sin ruta,
  credenciales, consulta, fragmento ni barra final. Registrar lo observado en las
  configuraciones efectivamente servidas: `sourceConfigProject:
"hhr-serviciohospitalizados"` y `targetConfigProject: "hhr-pruebas"`.
  Exigir `legacyOriginPreserved: true` y `targetSessionTestPassed: true`:
  comprobar acceso institucional, lectura, guardado y reapertura en el nuevo sitio,
  ausencia de operaciones pendientes del destino y conservación del antiguo.
  No marcar por ello `sameOriginTransitionTestPassed`: es otra prueba.
- **Misma dirección:** `strategy: "same-origin"` y
  `sameOriginTransitionTestPassed: true`. Probar expresamente el cambio de Firebase
  con el mismo UID sin mezclar caché ni reenviar operaciones antiguas. Las evidencias
  anteriores sin `strategy` conservan esta exigencia; una estrategia desconocida falla.

Una URL propuesta o dos nombres de sitios no acreditan aislamiento ni publicación.
Los valores anteriores son comprobantes revisados, no verificaciones automáticas de
Netlify o Firebase. El control sigue siendo de solo lectura y nunca autoriza el corte.
La futura aplicación de pruebas también debe tener un origen y datos separados del
entorno que se promueva.

## Orden operativo

1. Actualizar el inventario y validar identidad y episodio de los candidatos.
   Documentar los pendientes; todavía no aplicar importaciones.
2. Preparar la recuperación de textos vacíos por paciente, día y turno y el archivo
   de versiones originales de PDF. Estas propuestas siguen siendo de solo lectura.
3. Antes de aplicar cualquier lote, detener el espejo antiguo en un cambio
   autorizado aparte y comprobar ausencia de escrituras nuevas. No arreglar su
   autenticación para reactivarlo. Después, aplicar solo los lotes verificados con
   precondiciones y recibos, conservando el censo corregido y el CUDYR saneado.
4. Alinear despliegue, reglas, personal y accesos. Verificar antes la estrategia de
   aislamiento elegida: dirección nueva o transición probada en la misma dirección.
   Una clave basada solo en UID no aísla dos Firebase en el mismo origen.
5. Ensayar con respaldo restaurable y comprobaciones de lectura, sincronización
   de hoy/ayer y repetición sin duplicados. No vaciar colas locales sin revisarlas.
6. Acordar ventana de corte, responsables y retorno. Si falla identidad, CUDYR,
   guardado o sincronización, detener el corte y conservar el servicio anterior.

El diagnóstico del 13–15 de octubre de 2026 encontró riesgos en espejo, caché,
accesos, reglas y restauración. Es un punto de partida, no evidencia vigente de que
ya estén solucionados. Este PR no los da por cerrados ni despliega cambios.

## Restaurar CUDYR oficial sin recalcularlo

La importación administrada de Firestore regenera `updateTime`. Un informe oficial
puede conservar todos sus campos y no superar por ello la huella de sus fuentes.
No recalcular, volver a aprobar ni sobrescribir ese informe para ocultar la diferencia.

Después de importar en una base aislada y con acceso de clientes denegado,
usar las Application Default Credentials del operador autorizado (sin copiar claves
ni tokens al repositorio):

```sh
GCLOUD_BIN=/ruta/a/gcloud node scripts/migration/attestCudyrRestore.mjs \
  --database migration-restore-AAAAMMDD-1234abcd --month 2026-08 \
  --apply --receipt /ruta/privada/agosto-restauracion.jsonl
```

El comando comprueba el proyecto y solo admite bases temporales de `hhr-pruebas`,
meses agosto/septiembre y un recibo nuevo. No crea/importa bases ni cambia reglas.
Compara en memoria el informe entero y **todos los campos** de las dependencias
que usa el lector oficial, dentro de transacciones consistentes. La fuente original
debe seguir siendo oficial por su propia huella; no se permiten cadenas de avales.
Una diferencia de contenido o un tipo no soportado detiene la operación. Se
comparan los campos tipados protobuf del SDK, no solo `data()`, que puede equiparar
enteros y decimales. El adaptador interno falla de forma cerrada si cambia el SDK
y tiene pruebas de integración; no se usa para leer las fuentes en la ruta normal.

Solo crea un comprobante en `cudyrOfficialReports/{mes}/restorations/{huella}`
de la copia aislada. Conserva informe, versión, aprobación y resultados originales.
El lector consulta ese comprobante únicamente cuando la huella ordinaria difiere;
comprueba base, hospital, mes, versión y hash del informe. Una revisión documental o exclusión guardada por los escritores soportados
cambia la huella y exige una revisión nueva. Esos escritores conservan revisiones
y no borran físicamente las fuentes. La comprobación conserva ese contrato; no
es un registro de todos los cambios administrativos. Un borrado directo con IAM
requiere retirar también los comprobantes de restauración afectados.
Los clientes no tienen permisos para escribir comprobantes. El proceso no se
publica como función invocable.

El recibo se sincroniza a disco antes del intento. Si hay interrupción o respuesta
incierta, revisar el recibo y el comprobante antes de repetir; no borrar el recibo
para reintentar. El escritor usa un solo intento transaccional. La comparación
no convierte una exportación concurrente en un respaldo atómico: el ensayo final
requiere un instante consistente o una ventana sin cambios comprobada, además
de censo, enfermería, índices, reglas, accesos y objetos de Storage.

Referencia: [exportación e importación de Firestore](https://firebase.google.com/docs/firestore/manage-data/export-import).
