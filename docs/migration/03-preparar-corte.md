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

| Clave          | Evidencia exigida                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects`     | `sourceId`, `sourceNumber`, `targetId`, `targetNumber` de `gcloud projects describe`. Números como texto.                                                                                                          |
| `inventory`    | `readWindowStable: true`, `officialCudyrUnchanged: true`, `cloudWrites: 0`, `reportHash` SHA-256 del informe recién obtenido.                                                                                      |
| `mirror`       | Proyecto antiguo, `function: "mirrorDailyRecords"`, `state: "disabled"`, con prueba de que dejó de ejecutar. Un error de credenciales **no** demuestra detención.                                                  |
| `deployment`   | Proyecto destino, `expectedCommit` y `deployedCommit` completos, iguales y verificados en el despliegue.                                                                                                           |
| `rules`        | Proyecto destino, `expectedHash` y `deployedHash` SHA-256 iguales, cotejando reglas locales y desplegadas.                                                                                                         |
| `localSession` | Proyecto destino, `projectIsolationVerified: true`, `pendingOperations: 0`, `sameOriginTransitionTestPassed: true`. Probar cambio de Firebase con el mismo UID sin mezclar caché ni reenviar operaciones antiguas. |
| `access`       | Proyecto destino, `pendingAuthorizations: 0`, `unmappedStaff: 0`, `rolesReviewed: true`. Mantener autores históricos y validar roles; no concederlos por semejanza de nombres.                                     |
| `restore`      | Proyecto destino, `restoreTestPassed: true`, `originalsPreserved: true`, `backupManifestHash` SHA-256. Probar restauración aislada; tener un bucket no basta.                                                      |

Todos los bloques excepto `projects` e `inventory` llevan `project`. El informe
impreso contiene únicamente los estados de los controles; no reproduce referencias,
credenciales, nombres, correos ni datos clínicos. Código 0: evidencias suficientes
para preparar un ensayo; 2: pendientes; 1: entrada inválida. `readyForRehearsal`
no es permiso para un corte ni una verificación independiente de los comprobantes.

## Orden operativo

1. Actualizar el inventario; resolver solo candidatos con identidad y episodio
   comprobados. Documentar los casos que siguen pendientes.
2. Completar textos de enfermería vacíos por paciente, día y turno, preservando el
   destino. Conservar versiones originales de los PDF, incluso si comparten ruta.
3. En un cambio autorizado aparte, detener el espejo antiguo y comprobar ausencia
   de escrituras nuevas. No arreglar su autenticación para reactivarlo.
4. Alinear despliegue, reglas, personal y accesos. Resolver antes el aislamiento de
   caché por proyecto: una clave basada solo en UID no es suficiente.
5. Ensayar con respaldo restaurable y comprobaciones de lectura, sincronización
   de hoy/ayer y repetición sin duplicados. No vaciar colas locales sin revisarlas.
6. Acordar ventana de corte, responsables y retorno. Si falla identidad, CUDYR,
   guardado o sincronización, detener el corte y conservar el servicio anterior.

El diagnóstico del 13–15 de octubre de 2026 encontró riesgos en espejo, caché,
accesos, reglas y restauración. Es un punto de partida, no evidencia vigente de que
ya estén solucionados. Este PR no los da por cerrados ni despliega cambios.
