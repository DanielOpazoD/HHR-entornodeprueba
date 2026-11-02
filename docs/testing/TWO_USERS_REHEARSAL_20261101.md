# Ensayo de dos equipos en un mismo censo — 2026-11-01

> Informe original conservado. Sus resultados y rutas corresponden a la base histórica indicada abajo; el estado vigente de cierre está en la sección final.

Base: `4d1b4a1c7df08345148c2d117bbe735ffaac48db` de `origin/main`.
Rama: `claude/two-users-rehearsal-20261101`. Investigación; no modifica producción.

Se reprodujeron dos pérdidas de una edición confirmada en la ruta `client_only`,
una retención innecesaria de trabajo independiente en la ruta de autoridad y un
mensaje de dotación que atribuye el cambio al campo equivocado. No se comprobó
qué ruta está activa en producción ni se accedió a sus datos.

## Alcance del montaje

- Node 22.22.2; Firestore emulado en loopback, proyecto `demo-hhr-dos-usuarios`.
- Dos clientes SDK autenticados con UID diferentes. `AsyncLocalStorage` vincula
  cada operación a su SDK y actor durante todo el recorrido asíncrono. No se
  cambia un singleton mutable de conexión a mitad de una operación.
- Casos 1–3: ambos actores son editores sintéticos con rol `nurse_hospital`.
  El caso 7 usa enfermería y `doctor_urgency`.
- Se ejecuta `updateRecordPartial`, el escritor real de almacenamiento. La ruta
  directa conserva SDK, reglas, lecturas y escrituras reales del emulador.
  Una barrera **después** de las dos verificaciones reales de versión impone el
  cruce comprobar–escribir de los casos directos; no inventa respuestas del SDK.
- En `enforced`, la política v2 se guarda en el emulador. Un doble sustituye solo
  el transporte callable por `.run(...)` del manejador de `functions/lib`, con
  transacciones reales del SDK de administración. La resolución de rol del
  servidor se inyecta; no se prueba el inicio de sesión ni la infraestructura de
  Functions. Se conserva la normalización de errores a `ConcurrencyError`.
- Caso 5: `updatePartialDetailed` escribe la proyección y tarea reales en Dexie
  sobre `fake-indexeddb`; luego se ejecuta `processSyncQueue` y su transporte
  real. La desconexión es el estado `local_only/offline` del repositorio, no un
  corte físico ni una pestaña de navegador sin red. El otro cliente escribe sin
  compartir la proyección local. Solo se avanza el reloj de elegibilidad de la
  cola aislada; no se modifica su contenido para forzar la publicación.
- El caso 6 reutiliza los ensayos existentes del hook de UI. No se abrieron dos
  navegadores, ni se probaron avisos visuales de los casos 1–5 o 7. Éxito del
  escritor no equivale a haber observado un indicador de «guardado» en pantalla.
- Los reintentos con base fresca indicados abajo los hace **el ensayo**. No
  acreditan recuperación automática de la aplicación.

## Resultado por caso

| Caso                                    | Qué ocurrió                                                                                                                                                                                                                                              | ¿Se pierde algo?                                                                                                                                          | Qué recibe o ve cada persona                                                                                                                                                                    | Cómo se probó                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Camas distintas                      | Directa: las dos promesas resuelven y quedan ambas patologías. Autoridad: una confirma y otra devuelve conflicto de versión; el reintento con una lectura fresca conserva ambas.                                                                         | No en el recorrido ensayado.                                                                                                                              | Directa: ambos escritores reciben éxito. Autoridad: uno recibe `ConcurrencyError`. Avisos de las dos UI no observados.                                                                          | Escritor real + dos SDK/emulador. Autoridad con doble de transporte hacia manejador real.                                                                                                                         |
| 2. Campos distintos de una cama         | Patología y edad se conservan. La autoridad disputa la revisión del documento completo, aunque los campos sean distintos; se completa el segundo cambio tras leer la base fresca.                                                                        | No tras el reintento explícito del ensayo.                                                                                                                | Igual que el caso 1. No se ha medido si el repositorio/UI recupera automáticamente esa colisión entre equipos.                                                                                  | Mismo montaje; misma persona y episodio en la cama.                                                                                                                                                               |
| 3. Mismo campo                          | Directa: ambas operaciones terminan sin rechazo; solo queda A o B. Autoridad: exactamente una confirma y la otra devuelve `ConcurrencyError`.                                                                                                            | **Sí en directa:** una edición aceptada deja de ser el valor del servidor, sin conflicto en la respuesta. No en autoridad: hay rechazo explícito.         | Directa: ambos reciben éxito; no existe señal de colisión en esas respuestas. Autoridad: el perdedor recibe conflicto. UI y posible historial no comprobados.                                   | Carrera determinista tras comprobaciones reales. Contrato directo conservado como `it.fails`.                                                                                                                     |
| 4. Edición y Eloísa                     | Una edición manual en R2 y el lote clínico de temperatura en R1 parten de la misma revisión: una operación confirma y la otra aborta. Tras lectura fresca y reintento quedan ambos cambios.                                                              | No en este lote clínico.                                                                                                                                  | El escritor manual recibe `ConcurrencyError` si pierde; el lote recibe `aborted` si pierde. Avisos de la extensión/UI no observados.                                                            | Manejador real `applyRayenClinicalEnrichmentBatch` y escritor real contra el emulador; transporte callable sustituido. **No probado:** captura, extensión, sincronización estructural completa ni HTTP Functions. |
| 5. Sin conexión, B guarda y A reconecta | Directa, camas distintas: convergen y la tarea termina. Directa, mismo campo: la tarea de A reemplaza B y desaparece. Autoridad, mismo campo: conserva B y A queda `CONFLICT`. Autoridad, camas distintas: también deja A en `CONFLICT`, sin publicarla. | **Sí en directa/mismo campo:** desaparece el valor confirmado de B sin decisión explícita. En autoridad no se borra A: sigue en proyección y tarea local. | A recibe inicialmente `savedLocally: true`, `updatedRemotely: false`. B confirma. En directa el replay termina sin conflicto; en autoridad queda una tarea `CONFLICT`. Panel visual no montado. | Repositorio → Dexie real sobre IndexedDB falso → trabajador/transportes reales → emulador; desconexión simulada por estado. Dos contratos discrepantes en `it.fails`.                                             |
| 6. Pestaña oculta que vuelve            | Los ensayos existentes refrescan desde Firebase antes de aceptar la edición de estado y conservan la patología remota. Un snapshot de caché no acredita frescura; el posterior de servidor sí.                                                           | No en estos ensayos del hook.                                                                                                                             | El hook adopta el dato remoto y permite editar. Se comprueba que no se emite la advertencia concreta «Censo en actualización / Revise los datos antes de editar».                               | Cobertura existente reejecutada: hook/QueryClient + SDK/emulador; cambios remotos sembrados. No equivale a dos pestañas reales con visibilidad del navegador.                                                     |
| 7. Dotación y cama                      | Se ensayan arranque concurrente y ambos órdenes con base antigua. La transacción de dotación y el callable médico conservan los cambios aceptados; los rechazos por versión se completan al recargar la base en el ensayo.                               | No en las variantes ensayadas.                                                                                                                            | Si el médico ya guardó solo la patología, enfermería recibe «La dotación cambió en otro equipo…», aunque la dotación no cambió. Texto de error observado; aviso visual no probado.              | Dotación: escritor/transacción SDK real y reglas. Médico: escritor y manejador de autoridad reales con doble del transporte. El contrato de mensaje correcto queda en `it.fails`.                                 |

## Defectos por riesgo

1. **P1 — Escrituras directas simultáneas del mismo campo aceptadas sin conflicto.**
   La comprobación de versión se completa antes del `updateDoc`, dejando una
   ventana donde ambos equipos aceptan la base. Se observa pérdida del valor de
   una escritura confirmada, no borrado de paciente ni pérdida de una cama.
   Fuente: `src/services/storage/firestore/firestoreRecordWrites.ts:237,402,408`.
   Relación con SAVE-01: el éxito de ambas operaciones no informa que una edición
   queda desplazada por otra concurrente.
2. **P1 — Replay directo de la cola reemplaza una edición confirmada del mismo campo.**
   La escritura directa no registra sus rutas en `meta.lastChangedPaths`; la
   protección de solapamiento del replay no detecta el cambio y publica la
   intención antigua. La tarea termina; el valor de B deja de ser el del
   servidor sin una decisión explícita. No se acredita recuperabilidad desde
   historial ni desde la UI de B.
   Fuentes: `firestoreRecordWrites.ts:408`,
   `src/services/storage/sync/firestoreSyncConflictPolicy.ts:143`,
   `src/services/storage/sync/firestoreSyncTransport.ts:242`.
3. **P2 — Una edición offline de otra cama queda retenida en autoridad.**
   Después de reconciliar campos independientes, el transporte de la cola manda
   al callable la versión/revisión original de la tarea. El servidor la rechaza
   y la tarea termina `CONFLICT`. Se conserva el payload local; no se acredita
   pérdida, pero tampoco convergencia automática de trabajo independiente.
   Fuente: `src/services/storage/sync/firestoreSyncTransport.ts:350,353`.
4. **P3 — El conflicto de dotación describe un cambio de dotación inexistente.**
   Solo cambió una patología; el error genérico de versión dice que cambió la
   dotación. El bloqueo protege los datos, pero su explicación es inexacta.
   Fuente: `src/services/storage/firestore/firestoreRecordWrites.ts:384`.
   Se verifica el texto del error, no su presentación visual.

No se modificó ninguna de esas fuentes de producción.

## Cobertura existente y reutilización

- `src/tests/emulator-ui/dailyRecordSyncQuery.emulator-ui.test.tsx`: 5 pruebas,
  lectura/suscripción, parche desde el hook, refresco antes de editar, retorno
  desde inactividad y conservación del censo ante un documento remoto ausente.
- `src/tests/emulator-ui/dailyRecordServerConfirmation.emulator-ui.test.ts`:
  4 pruebas, metadatos reales de caché/servidor, retorno con/sin cambios y lectura
  fallida offline. `dailyRecordSyncQueryDiagnosticLocks...`: 1 prueba, edición
  de otro grupo tras confirmación remota. Se reejecutaron las 10.
- `src/tests/rayen-import/rayenSyncHistoryConcurrency.outbox.test.ts`: 18 pruebas
  pasadas. Rebase local del historial por ID, retención de estados terminales,
  rechazo de dos cambios incompatibles del mismo ID y recarga por los hooks de
  auditoría. Firestore está deshabilitado: no prueba concurrencia remota del
  lote clínico ni de la sincronización completa.
- `e2e/multiuser-offline-conflict.spec.ts`: conserva trabajos bloqueados y prueba
  dos contextos con persistencia local y transporte de autoridad controlado. El
  snapshot del otro contexto se inyecta para la siguiente carga; los escenarios
  reconectan A antes de guardar B. No ejecutan el intercalado del caso 5 sobre
  un servidor común. Inspeccionado, **no ejecutado en este encargo**.
- `e2e/sync-conflict-resolution.spec.ts`: snapshots externos mediante override
  y recarga, no dos escritores contra Firestore. `e2e/pre-outbox-multitab.spec.ts`:
  IndexedDB entre pestañas y aislamiento entre contextos; no la carrera remota.
  `e2e/chaos-network.spec.ts`: desconexión de un contexto, sin segundo escritor.
  Inspeccionados, **no ejecutados**.
- `src/tests/emulator/atomic-write-guards.emulator.test.ts` ya prueba dos guardados
  completos con la misma base y protección de borrados. No se duplica ese caso
  ni se atribuye su protección transaccional al `updateDoc` parcial.

## Verificación y reproducción

Archivo nuevo: `src/tests/emulator-ui/twoUsersRehearsal.emulator-ui.test.ts` (menos
de 500 líneas), **15 pruebas: 11 conformes y 4 fallos esperados**. Las 10 pruebas
previas de emulador y las 18 unitarias de historial pasaron. Un `it.fails` aprobado
acredita una discrepancia reproducida, **no una corrección ni aprobación clínica**.

Se ejecutó también el archivo sin los marcadores `it.fails`, restaurándolos al
terminar: fallaron exactamente los cuatro contratos descritos, con estas diferencias:

- caso 3: se esperaba un rechazo; hubo **0**;
- caso 5 directa/mismo campo: se esperaba `B ONLINE`; quedó `A OFFLINE`;
- caso 5 autoridad/camas distintas: se esperaba cola vacía; quedó **1** tarea;
- caso 7: el mensaje contiene `La dotación cambió`, aunque solo cambió la cama.

Comandos (Node 22 en `PATH`):

```sh
./node_modules/.bin/firebase emulators:exec --project demo-hhr-dos-usuarios --only firestore \
  "RUN_FIRESTORE_EMULATOR_TESTS=1 npx vitest run -c vitest.emulator-ui.config.ts src/tests/emulator-ui/twoUsersRehearsal.emulator-ui.test.ts src/tests/emulator-ui/dailyRecordSyncQuery.emulator-ui.test.tsx src/tests/emulator-ui/dailyRecordServerConfirmation.emulator-ui.test.ts src/tests/emulator-ui/dailyRecordSyncQueryDiagnosticLocks.emulator-ui.test.tsx --maxWorkers=1 --reporter=verbose"
npx vitest run src/tests/rayen-import/rayenSyncHistoryConcurrency.outbox.test.ts
npx eslint --max-warnings 0 src/tests/emulator-ui/twoUsersRehearsal.emulator-ui.test.ts
npm run check:test-governance
```

Evidencia local de esta sesión: `/tmp/hhr-two-users-final.log`,
`/tmp/hhr-two-users-strict.log`, `/tmp/hhr-two-users-history.log`.
El hook de commit ejecuta tipos, control de secretos y lint de staged; no se omite.

## Lo que queda sin acreditar

No hay medición de producción, frecuencia de las carreras, carga de varios turnos,
comportamiento con latencia de red real, HTTP/Auth de Functions, sincronización
estructural completa de Eloísa, dos navegadores con UI simultánea, recuperación
automática del repositorio en las colisiones online, ni la experiencia visual de
ambas personas ante cada rechazo. No se ejecutó la matriz completa ni CI; no hay
PR ni despliegue. El ensayo no acredita preparación completa para el 2026-11-08.

## Estado de cierre por hallazgo — 2026-11-01

Comparación contra `origin/main` en `d144ff99dea248f10d7725cca9fef2ae6889f3c5`.
Esta consolidación no cambia código de producción ni acredita un despliegue.
El responsable acepta los riesgos indicados **hasta después del 2026-11-08**;
la fecha no autoriza resolverlos automáticamente ni convierte el defecto en correcto.

| Hallazgo                                                   | Estado al consolidar                                                   | Destino de la evidencia                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: dos escrituras directas del mismo campo tienen éxito   | **Pendiente aceptado** por el responsable hasta después del 2026-11-08 | Caso 3 directo en `twoUsersRehearsalContracts.emulator-ui.test.ts`, con `it.fails` y motivo.                                                          |
| P1: reenvío directo sobrescribe la edición confirmada de B | **Pendiente aceptado** con el mismo plazo                              | Caso 5 directo/mismo campo en la suite consolidada, como fallo esperado.                                                                              |
| P2: edición offline de otra cama retenida en autoridad     | **Pendiente en curso**, no aceptado como riesgo en este encargo        | Rama `claude/offline-edit-other-bed-no-conflict-20261101`; ya posee `twoUsersRehearsal.emulator-ui.test.ts`. No se incorpora ni modifica ese archivo. |
| P3: mensaje de dotación atribuye incorrectamente el cambio | **Pendiente en curso**, no marcado como corregido ni aceptado          | Rama `claude/staffing-save-message-20261101`; se deja allí el contrato de mensaje. No tiene PR de corrección acreditada al consolidar.                |

### Destino de cada prueba original

`src/tests/emulator-ui/twoUsersRehearsalContracts.emulator-ui.test.ts` conserva
los escenarios que no pertenecen a las correcciones en curso. Vive en
`emulator-ui/` porque necesita SDK, almacenamiento real y el entorno jsdom de
esa configuración. No se modifica el archivo que usa la rama offline.

| Prueba original                                           | Casos originales | Destino                                                                                                                                 |
| --------------------------------------------------------- | ---------------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1: camas distintas, directa y autoridad                   |                2 | Contratos positivos en la suite consolidada; no había equivalentes del escritor parcial real en main.                                   |
| 2: campos distintos de la misma cama, directa y autoridad |                2 | Contratos positivos en la suite consolidada.                                                                                            |
| 3: mismo campo con autoridad                              |                1 | Contrato positivo: un rechazo explícito y un valor confirmado.                                                                          |
| 3: mismo campo directo                                    |                1 | `it.fails`, riesgo aceptado.                                                                                                            |
| 4: lote clínico y edición manual                          |                1 | Contrato positivo, transacciones reales; reintento explícito del ensayo.                                                                |
| 5: reenvío directo a otra cama                            |                1 | Contrato positivo en la suite consolidada.                                                                                              |
| 5: reenvío directo al mismo campo                         |                1 | Fallo esperado, riesgo aceptado.                                                                                                        |
| 5: reenvío con autoridad, otra cama y mismo campo         |                2 | No se agregan: pertenecen a la rama offline en curso, con controles adicionales propios.                                                |
| 6: vuelta de pestaña oculta                               |         0 nuevos | Ya cubierto en main por `dailyRecordSyncQuery`, `dailyRecordServerConfirmation` y `dailyRecordSyncQueryDiagnosticLocks`; no se duplica. |
| 7: dotación concurrente y ambos órdenes de guardado       |                3 | Contratos positivos en la suite consolidada.                                                                                            |
| 7: texto del conflicto de dotación                        |                1 | No se agrega: corresponde a la rama de mensaje en curso.                                                                                |
| **Total original**                                        |           **15** | **12 conservados: 10 positivos y 2 fallos esperados; 3 diferidos a ramas activas.**                                                     |

Los casos diferidos siguen conservados en las ramas de corrección mencionadas.
La rama original de ensayo puede retirarse tras revisar esta consolidación y
confirmar que esas ramas activas mantienen su evidencia. No se borra ninguna rama.
