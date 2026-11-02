# Ensayo de cuentas sucesivas en un mismo Chrome

> Informe original conservado. Los defectos, plazos y referencias siguientes describen la base histórica; la sección final registra las correcciones y los pendientes vigentes.

Base examinada: `e28343c6a14923780d26314a7579b027f7ff4347` de `origin/main`.
Rama de entrega: `claude/shared-computer-rehearsal-20261101`.
Escenario solicitado: desde el 8 de noviembre, varias cuentas de enfermería se turnan
en el mismo computador y perfil. La cifra de 23 cuentas procede del encargo; no se
consultó el padrón real ni Firebase de producción.

**La cola conserva el trabajo durable de A, pero su entrega no continúa automáticamente
tras cerrar sesión. Además, el lote clínico puede continuar una corrida de A bajo B.**
Esta última combinación se reproduce por separado en el cliente y en el servidor;
no se ensayó una corrida completa en Chrome con servicios Eloísa reales.

P = prueba ejecutada; L = lectura de código. Las tablas están ordenadas por riesgo.
Las propuestas no se implementan en esta rama. No se observó borrado de la edición
que ya estaba en la cola; eso no certifica todo texto aún residente en un editor,
la supervivencia a borrar el perfil ni todos los fallos del almacenamiento físico.

## 6. Cerrar sesión durante una corrida; vencimiento a las 12 horas — alto

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **P:** `applyClinicalEnrichmentBatch` inicia con A, su lectura autoritativa cruza un cierre manual o automático, se admite B y el lote todavía invoca el transporte con el `runId` antiguo. **P, emulador:** B puede enriquecer y archivar para una corrida cuyo `by` sigue siendo A; `firstCapturedBy` resulta B. En cambio, la cola general no adopta en B la confirmación tardía de A y conserva su tarea. **P, suites existentes:** la preparación de captura se cancela al sustituir sesión/desmontar, pero el trabajo ya comprometido puede continuar al desmontar. |
| Riesgo real      | **Autoría mezclada y continuidad silenciosa de una corrida anterior.** Una petición que ya salió no se revierte por cerrar sesión. No se reprodujo pérdida clínica ni un bypass de un rol no autorizado. La combinación completa con el SDK de Functions autenticando peticiones mientras Chrome cambia de usuario queda sin ensayo de extremo a extremo.                                                                                                                                                                                                                 |
| Evidencia        | Nuevas: `src/tests/services/storage/sharedComputerRehearsal.test.ts:238` (manual y automático), `:124` (ACK tardío); `src/tests/emulator/sharedComputerAuthority.emulator.test.ts:282` (corrida A, ejecutor B). Código L: `src/features/rayen-import/hooks/applyClinicalEnrichmentBatch.ts:74` y `:136`; `functions/lib/rayenClinicalBatchAuthority.js:71`; `src/features/rayen-import/hooks/useRayenClinicalFill.ts:112`. Captura: `src/tests/rayen-import/useRayenImportCapture.unmount.test.ts:87`.                                                                    |
| Propuesta mínima | Capturar propietario y generación al iniciar la fase clínica; comprobarlos tras las esperas y antes de cada envío, reintento y adopción local. Conservar lo ya confirmado y el trabajo durable. Para continuar con B, exigir una nueva ejecución explícita con su autoría. Registrar UID de quien inicia y quien aplica, además del nombre mostrado. No intentar deshacer una transacción confirmada.                                                                                                                                                                     |

Las **12 horas no provocan un reinicio programado de Chrome**. Para cuentas `hhrn_`,
`useNursingSessionMonitor.ts:14` conecta el monitor al mismo cierre automático.
`nursingSessionMonitor.ts:17` fija el vencimiento desde `auth_time`; `:39` comprueba
cada 60 segundos y también al volver a la pestaña. Las reglas y el servidor rechazan
la sesión desde las 12 horas, aunque la interfaz aún no haya comprobado el reloj.
El refresco del token no cambia el inicio de autenticación.

P: la suite existente `nursingSessionMonitor.test.ts` comprueba vencimiento incluso
oculto y sin conexión al consultar roles; la nueva suite de emulador rechaza lectura,
escritura estructural, lote clínico, archivo y lectura CUDYR con `auth_time` de hace
43.201 segundos. P: el cierre automático conserva y bloquea la edición local.
L: al vencer durante una corrida, operaciones anteriores pueden estar confirmadas
y las posteriores resultar rechazadas; no existe una transacción única para toda
la corrida. Si luego entra B, aplica el defecto de continuidad descrito arriba.
No se simuló una corrida completa de doce horas ni el ciclo completo del Auth SDK.

## 3. A deja la sesión abierta y B trabaja — alto

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Qué ocurre hoy   | **P:** las pulsaciones del siguiente operador mantienen viva la sesión de A. El cierre por inactividad es de **8 horas**, con una gracia de un segundo para mensajes entre pestañas y sujeto a suspensión del navegador. **L:** auditoría usa UID/correo/nombre de la sesión activa; el historial de sincronización usa su nombre o correo. El programa no reconoce qué persona física está frente al teclado. El bloqueo con PIN es opcional y viene desactivado. |
| Riesgo real      | **Autoría errada:** B queda identificado como A. Las 8 horas no protegen un relevo inmediato, y la actividad de B reinicia ese plazo. El vencimiento absoluto de 12 horas corresponde a las cuentas individuales monitorizadas, no es una identificación del nuevo operador.                                                                                                                                                                                       |
| Evidencia        | P: `sharedComputerRehearsal.test.ts:206`; suites `sessionActivityMonitor.test.ts` y `nursingSessionMonitor.test.ts`. L: `src/constants/security.ts:12`; `src/services/auth/sessionActivityMonitor.ts:54`; `src/services/admin/auditCore.ts:226`; `src/features/rayen-import/hooks/useRayenImport.ts:94`; `src/context/SecurityContext.tsx:31`.                                                                                                                     |
| Propuesta mínima | Hacer el relevo explícito mediante el cierre/cambio de usuario y mostrar de forma inequívoca la cuenta activa. Si se decide añadir bloqueo o reautenticación para el relevo, es una decisión del responsable. No cambiar silenciosamente el plazo vigente de 8 horas. El PIN compartido no demuestra autoría individual.                                                                                                                                           |

## 1. A deja una edición pendiente y entra B — alto operativo

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **P:** cerrar sesión limpia el día local, conserva el payload y su contrato en IndexedDB, retira el intento activo y deja la tarea `FAILED`, con `session_owner_logged_out` y `projectionReleased`. B no la recibe en sus operaciones ni en sus contadores normales; A vuelve a verla al ingresar. **No se envía sola ni se puede reintentar tal cual, tampoco cuando vuelve A.** A dispone de revisión y copia descargable; el panel pide comparar con el censo y reingresar a mano lo que falte. Nuevas ediciones usan otra tarea y no pisan la copia retenida. |
| Riesgo real      | **Bloqueo de la entrega y omisión clínica si A no regresa o nadie realiza la revisión.** Es una copia conservada, no un guardado remoto. No hay un traspaso operativo a B ni aviso clínico de los pendientes de A. El contador técnico `orphanedTasks` llega al reporte de salud, pero no sustituye una acción de relevo. B puede tener “0 por enviar” aunque exista esa edición en el equipo. No se observó pérdida de la cola por el cierre.                                                                                                                    |
| Evidencia        | P: `sharedComputerRehearsal.test.ts:96` y `:223`; suites `sessionLogoutQueuePreservation`, `sessionLogoutRetainedDayWork`, `sessionLogoutQueueFencing`; UI `RayenSyncQueueDetails.test.tsx:168`. L: `src/services/storage/sessionSyncQueuePreservation.ts:21`; `src/services/storage/sync/dexieSyncQueueQuarantine.ts:100`; `src/services/storage/sync/dexieSyncQueueStore.ts:113`; `src/features/rayen-import/components/RayenSyncQueueDetails.tsx:91`; `src/hooks/controllers/systemHealthReporterController.ts:240`.                                           |
| Propuesta mínima | Usar la revisión y respaldo existentes antes del relevo. Si se autoriza un aviso, que sea accionable antes de cerrar cuando una edición no se recuperará sola; no añadir alertas rutinarias al censo. Para un traspaso posterior, exponer solo un aviso sin datos de pacientes y exigir la revisión autorizada; nunca reasignar ni reenviar automáticamente el payload de A como si lo hubiera editado B.                                                                                                                                                         |

Se contrastaron #1055 (`111c41833`) y #1092 (`e785acc29`) en el historial local.
El primero conserva los envíos propios; el segundo libera la proyección del día
sin eliminar el envío. No basta interpretar `session_owner_cleared` como cola
eliminada: `sessionScopedStorageService.ts:244` registra telemetría de aislamiento.
La operación que limpia los días y conserva las tareas es transaccional en Dexie.
Como se limpian todos los días locales, también se bloquean las tareas de día de
otros propietarios cuya proyección se retira; las regresiones existentes lo prueban.
Ninguna de estas pruebas autoriza purgar tareas por antigüedad o fallos (SAVE-03).

## 4. Permisos de `nurse_hospital` de punta a punta — medio, con excepción comprobada

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **L:** el rol puede editar CENSUS; el encabezado presenta Sincronizar si no es de solo lectura/especialista. La confirmación se condiciona a cambios y revisión de conflictos, no a `admin`. **P, emulador para A y B:** permiso efectivo individual → lectura de política → guardado estructural por autoridad → lote clínico del mismo día → archivo CUDYR → lectura CUDYR por callable. Las reglas rechazan la escritura directa de campos clínicos con la política v2: debe usarse la autoridad.                                                                                          |
| Riesgo real      | **Bloqueo parcial:** el lote clínico CUDYR que apunta al día inmediatamente anterior al de la corrida **exige `admin`**, aun con cuenta de enfermería válida y corrida confirmada. No puede asegurarse “todas las sincronizaciones completas” para enfermería. Además, cambiar/publicar la política exige `admin`, y las correcciones estructurales históricas respetan la ventana vigente de 48 horas para enfermería.                                                                                                                                                                       |
| Evidencia        | P: `sharedComputerAuthority.emulator.test.ts:175` (A y B), `:250` (histórico rechazado). L: `src/shared/access/roleAccessMatrix.ts:71`; `src/features/census/components/CensusStaffHeader.tsx:126`; `src/features/rayen-import/components/RayenImportPreviewModal.tsx:384`; `functions/lib/dailyRecordWriteAuthorityFunctions.js:1150`; `functions/lib/rayenClinicalEnrichmentFunctions.js:253`, `:316` y `:351`; `functions/lib/cudyrHistoryFunctions.js:66`, `:184` y `:290`; `functions/lib/rayenClinicalBatchAuthority.js:97`; `rules/firestore/26-rayen-import-policy-helpers.rules:16`. |
| Propuesta mínima | Conservar los permisos actuales del flujo diario. Resolver explícitamente si enfermería debe poder aplicar el CUDYR histórico; si se autoriza, acotar el cambio al día previo, episodio y corrida revisada, con prueba de autorización negativa. Mientras tanto, presentar ese resultado como pendiente de resolución por un administrador. Mantener las 48 horas de `canWritePreviousDay`.                                                                                                                                                                                                   |

Traza concreta:

1. UI: matriz de rol → encabezado editable → botón → vista previa → confirmación.
   Esta cadena se leyó; no se ejecutó una sincronización completa de navegador.
2. `saveDailyRecordWithClinicalAuthority` llama a `assertAuthorizedDailyRecordWriter`
   y verifica permisos estructurales, versión y episodio. El ensayo usa su handler
   real y transacciones reales del emulador para ambos usuarios.
3. `applyRayenClinicalEnrichmentBatch` repite la autorización del usuario; vincula
   política, corrida y episodio. Para el mismo día admite enfermería. Para otro día
   tiene dos controles explícitos de administrador; el contrato solo admite D o D-1.
4. `archiveCudyrHistory` repite la autorización del escritor y llama a
   `assertCudyrArchiveAuthority`. Esta última comprueba política/corrida, no exige
   `admin`, y permite estados `applied`, `complete` o `partial`.
5. `cudyrHistory` no se lee directamente con el SDK cliente: las reglas lo deniegan.
   `readCudyrHistory` comprueba `hasCallableClinicalAccess` y sí permite la cuenta de
   enfermería. La prueba recorre ese camino y comprueba la denegación del directo.
6. La publicación de la política requiere administrador; su lectura no. Los ensayos
   fijan una política v2 sintética válida, no verifican la configuración desplegada.

## 5. Extensión y sesiones Eloísa compartidas — medio

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **P:** un permiso de episodio de la pestaña HHR sobrevive al cierre A→ingreso B y a despertar el worker; sigue habilitando la lectura con la sesión Eloísa compartida. Otra pestaña u otro episodio no recibe ese permiso, y caduca a los cinco minutos. **L:** las llamadas a Ficha usan el token de la sesión externa; no el UID de HHR. HHR registra el operador de su sesión en `run.by`. CUDYR conserva por separado `evaluation.author` de Eloísa y `firstCapturedBy` del usuario HHR. |
| Riesgo real      | **Lectura heredada entre sesiones HHR y atribución externa compartida.** Cambiar de cuenta en HHR no cambia la cuenta de Ficha/Gestión de Camas. No se probó que los registros de acceso del servidor Eloísa distingan a A y B: no se consultaron. El comportamiento no demuestra por sí solo acceso clínico de un rol HHR no autorizado; la extensión autoriza origen/pestaña/episodio, no el login HHR.                                                                                    |
| Evidencia        | P: `sharedComputerExtensionRehearsal.test.ts:79` y `:104`; `sharedComputerAuthority.emulator.test.ts:175` (autor del instrumento separado del capturador). L: `extension/tab-encounter-authorization.js:10` y `:31`; `extension/fichamedico-patient-flow-runtime.js:34`; `extension/fichamedico-clinical-client.js:99`; `src/features/rayen-import/hooks/useRayenSyncAudit.ts:79` y `:186`; `functions/lib/cudyrHistoryFunctions.js:233` y `:265`.                                           |
| Propuesta mínima | Revocar los permisos de episodio de esa pestaña al cambiar la generación HHR y obtener otra captura bajo B. Mostrar claramente las identidades HHR y Eloísa por separado, aprovechando el reporte de salud existente. Si se necesita autoría individual en Eloísa, cambiar también esa sesión o usar perfiles separados; no inventar el autor externo desde el nombre de HHR.                                                                                                                |

L, cachés: `fichamedico-capture-cache.js:5` crea una caché por captura, por lo que
no es una caché clínica indefinida. `clinical-antecedents-cache.js:9` conserva
respuestas 30 segundos; su llave incorpora la huella de la sesión externa y la
pestaña (`fichamedico-patient-context.js:159`), no el usuario HHR. Si la sesión
Eloísa no cambia, esa huella tampoco. No se ensayó en esta rama el consumo de
esa caché de antecedentes durante un cambio HHR; sí los permisos de episodios
con los scripts reales de la extensión en una VM y almacenamiento simulado.

## 2. Datos locales de A después de entrar B — medio, exposición técnica

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **P:** se borran los días locales y las claves privadas `hhr_`; la cola queda conservada y filtrada por propietario. Los borradores durables de entrega sobreviven, pero su lector devuelve a B una lista vacía y restituye el texto solo al volver A. **P:** telemetría local e historial de errores sobreviven y sus lectores no filtran por usuario. **L:** el cierre también limpia TanStack Query y avatares.                                       |
| Riesgo real      | **Datos residuales del otro usuario accesibles en el mismo perfil**, por herramientas de desarrollo o lectores técnicos sin filtro: payloads retenidos, borradores, contexto de errores y telemetría. No se demostró que B vea el borrador o la cola de A en la UI clínica normal; las pruebas muestran su aislamiento. Tampoco debe confundirse el censo hospitalario compartido que B tiene permiso de consultar con un dato privado filtrado desde A. |
| Evidencia        | P: `sharedComputerRehearsal.test.ts:96`, `:150` y `:179`. L: `src/services/storage/sessionScopedStorageService.ts:85`; `src/services/storage/medicalHandoffDraftStorage.ts:17` y `:156`; `src/services/observability/operationalTelemetryStore.ts:23` y `:32`; `src/services/storage/indexeddb/indexedDbErrorLogService.ts:21`; `src/services/storage/indexeddb/indexedDbDatabase.ts:13`; `src/hooks/useAuthStateSessionSupport.ts:132`.                 |
| Propuesta mínima | Limitar los lectores de diagnóstico al usuario/rol autorizado y separar su estado en memoria al relevar cuentas. Conservar los respaldos y borradores pendientes sin publicarlos como de B. Si se necesita aislamiento frente a una persona con acceso técnico al perfil, usar perfiles de Chrome/sesiones del sistema separados: un filtro de la UI no protege los bytes locales.                                                                       |

L: Firestore pide además `persistentLocalCache`
(`src/services/firebase-runtime/firebaseServiceBootstrap.ts:125`); no se encontró
su limpieza en la ruta de cierre examinada. **No se probó** su comportamiento
offline al sustituir usuarios ni una filtración por su caché SDK. La prueba de
telemetría siembra un evento sintético mediante el escritor de almacenamiento;
acredita retención y lectura, no todas las rutas de captura ni todos los paneles.

## 7. Primer ingreso de una cuenta pendiente — bajo en el límite probado

| Aspecto          | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qué ocurre hoy   | **P, emulador:** la clave inicial de una cuenta pendiente solo genera la continuación de establecimiento de clave; el estado sigue `pending`. Incluso con claims que dicen `nurse_hospital`, reglas, escritor estructural, lote clínico y callables CUDYR deniegan acceso. **L:** no se admite como sesión autorizada hasta completar activación; la preparación local de propietario precede a mostrar una sesión autorizada. Al entrar B ya activo tras un cierre correcto, la prueba de almacenamiento confirma que no recibe el día ni los pendientes de A. |
| Riesgo real      | **No se encontró un acceso clínico concedido por estar en el equipo de A.** Sí permanecen los residuos técnicos indicados en la pregunta 2, fuera del límite de la UI y reglas remotas. No se hizo el recorrido visual completo de activación con Auth real; no se certifica un perfil antiguo o dañado sin metadatos de propietario.                                                                                                                                                                                                                           |
| Evidencia        | P: `sharedComputerAuthority.emulator.test.ts:299` (inicio de clave, estado pendiente y denegaciones); `sharedComputerRehearsal.test.ts:96`; suite `NursingAccessForm.test.tsx`. L: `functions/lib/accounts/accountInitialPassword.js:12`; `functions/lib/accounts/accountAccess.js:9`; `functions/lib/accounts/accountCredentials.js:147`; `src/hooks/useAuthState.ts:137`; `src/features/auth/components/NursingAccessForm.tsx:85`.                                                                                                                            |
| Propuesta mínima | Mantener la barrera `pending` y completar activación antes del uso clínico. Hacer un ensayo de aceptación del flujo completo con Auth emulado y Chrome compartido, incluyendo regreso a A con cola pendiente. No reutilizar credenciales ni datos locales de A para completar el registro de B.                                                                                                                                                                                                                                                                 |

## Evidencia de ejecución y límites

- Node `22.22.2`, instalación con `npm ci`, sin modificar manifests ni lockfile.
- **16 casos nuevos:** 10 locales (Dexie/fake-indexeddb, Web Storage de la suite,
  temporizadores y scripts reales de extensión en VM); 6 con Firestore emulado.
- **93 casos existentes complementarios** aprobados en diez archivos: conservación,
  lectura de día retenido, aislamiento de envíos, actividad, vencimiento individual,
  preparación de captura, panel de cola, formulario y hooks de autenticación.
- Los defectos están en bloques `documented defect`; las aserciones documentan el
  comportamiento defectuoso actual. Que pasen no significa que se hayan corregido.
- ESLint de los tres archivos nuevos y `npm run check:test-governance` aprobados.
- Hook de commit: tipos de aplicación/Netlify, control de secretos y formato aprobados.
- Los handlers reales se llaman mediante `.run` con claims sintéticos y resolución
  real de roles contra el emulador. No hay servidor Functions ni Auth Emulator en
  ese ensayo; no acredita transporte HTTP, App Check, despliegue o sesiones reales.
- No se ejecutó la matriz CI completa, no se publicó producción y no se abrió PR.
  No se consultaron pacientes, cuentas reales ni logs de Eloísa. No se certifica
  ninguna extensión instalada ni configuración Netlify/Firebase desplegada.

Reproducción de los casos locales nuevos:

```sh
npx vitest run src/tests/services/storage/sharedComputerRehearsal.test.ts src/tests/rayen-import/sharedComputerExtensionRehearsal.test.ts --maxWorkers=1
```

Reproducción del emulador, usando el lanzador del repositorio y proyecto demo:

```bash
source scripts/lib/firebase-emulator-ci.sh
ensure_java_available
export FIRESTORE_EMULATOR_HOST="$(resolve_firestore_emulator_host)"
shared_config="$(mktemp "${TMPDIR:-/tmp}/hhr-shared-computer.XXXXXX")"
trap 'unlink "$shared_config"' EXIT
write_firestore_emulator_config "$shared_config" "$FIRESTORE_EMULATOR_HOST"
./node_modules/.bin/firebase emulators:exec --config "$shared_config" --project demo-hhr-shared-computer --only firestore \
  'RUN_FIRESTORE_EMULATOR_TESTS=1 ./node_modules/.bin/vitest run -c vitest.emulator.config.ts src/tests/emulator/sharedComputerAuthority.emulator.test.ts --maxWorkers=1'
```

Reglas afectadas por los hallazgos: SAVE-01 (distinguir copia local de confirmación),
SAVE-03 (conservar pendientes y respaldos), ID-01/02 (las pruebas fijan paciente y
episodio), TIME-02 (fechas clínicas del hospital). Las propuestas preservan los
controles de identidad, política, transacción y la ventana de edición vigente.

## Estado de cierre por hallazgo — 2026-11-01

Base de contraste: `origin/main` en `d144ff99dea248f10d7725cca9fef2ae6889f3c5`.
Durante el cierre, `origin/main` avanzó además a `079328ec0` con #1147.
La rama de consolidación conserva su base inicial; ese merge no se incorpora aquí.
Los resultados originales de arriba no son una descripción del producto corregido.
Los números de PR acreditan incorporación a main, no una nueva comprobación de
producción. No se consultó Firebase de producción ni se desplegó nada.

| Hallazgo original                                         | Estado vigente                                                            | Evidencia y límite                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6: una corrida de A continúa después de entrar B          | **Corregido, #1143**                                                      | Main conserva los contratos positivos de interrupción manual/automática en `sharedComputerRehearsal.test.ts`, más controles de sesión del lote, histórico y archivo. No se restaura el bloque `documented defect`.                                                                           |
| 3: cierre por inactividad a las ocho horas                | **Corregido, #1142**                                                      | Inactividad reducida a una hora y cuenta activa visible. `sessionActivityMonitor.test.ts`, `useInactivityLogout.test.tsx` y `nursingSessionMonitor.test.ts` conservan los controles. La actividad humana no identifica por sí misma al operador: sigue siendo necesario el relevo explícito. |
| 1: entrega de enfermería retenida al salir A              | **Corregido en su alcance autorizado, #1145**                             | Intento antes del cierre, respaldo/decisión cuando corresponde, recuperación de las rutas de enfermería al volver A y aviso a B sin contenido clínico. Otras rutas y conflictos conservan revisión; no se reasignan como trabajo de B.                                                       |
| 4: enfermería no puede sincronizar CUDYR del día anterior | **Corregido, #1144**                                                      | Main prueba ambos usuarios, reenvío idempotente y roles/campos denegados en `sharedComputerAuthority.emulator.test.ts`. Se conserva la ventana estructural de 48 horas.                                                                                                                      |
| 5a: permiso de episodio heredado entre sesiones HHR       | **Corregido en main, #1147**, incorporado después de la base de esta rama | `079328ec0` añade revocación por generación y pruebas en `tabEncounterAuthorizationSleep.test.ts` y `sessionGenerationBridge.test.ts`; no se copia el ensayo antiguo que afirmaba la herencia como éxito. Las suites nuevas de esta consolidación se ejecutaron sobre la base inicial.       |
| 5b: sesión de Eloísa compartida                           | **Pendiente aceptado** por el responsable hasta después del 2026-11-08    | Cambiar el usuario HHR no cambia el login externo. No se inventa autor de Eloísa ni se confunde la corrección del permiso HHR con cambiar la sesión externa. El montaje original comparte un doble de sesión externa: no demuestra cuentas reales ni logs externos.                          |
| 2: residuos técnicos en el perfil de Chrome               | **Pendiente aceptado** con el mismo plazo                                 | `sharedComputerRetainedState.test.ts` conserva el contrato de aislamiento de lectores como `it.fails`, con motivo explícito. Se comprueba que los bytes diagnósticos se conservan; no se propone borrado de pendientes. Los borradores siguen aislados por dueño en su lector.               |
| 7: cuenta pendiente sin acceso clínico                    | **Comportamiento ya correcto; sin corrección necesaria**                  | Los controles positivos/negativos de main siguen cubriendo establecimiento de clave y rechazo de reglas, escritor, lote y CUDYR.                                                                                                                                                             |

### Destino de cada prueba de la rama original

| Prueba original                                            |  Casos | Destino                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pendiente, B entra y A recupera revisión/respaldo        |      1 | Ya en main: `sharedComputerRehearsal.test.ts`; no se duplica. La recuperación de enfermería se amplió en #1145.                                                                                                                                                                                                                                                |
| ACK tardío de A no se adopta bajo B                        |      1 | Ya en main, misma suite.                                                                                                                                                                                                                                                                                                                                       |
| Telemetría y errores de A legibles por B                   |      1 | `sharedComputerRetainedState.test.ts`: `it.fails` exige lectores aislados, conserva la evidencia de retención y el motivo aceptado.                                                                                                                                                                                                                            |
| Borrador médico durable: salir, recargar, B y regreso de A |      1 | Contrato positivo en `sharedComputerRetainedState.test.ts`; completa la cobertura de main con el cierre real y reinicio de memoria del módulo.                                                                                                                                                                                                                 |
| Actividad del siguiente operador mantiene la sesión        |      1 | No se duplica: `sessionActivityMonitor.test.ts` cubre actividad y vencimiento; el plazo vigente es una hora (#1142).                                                                                                                                                                                                                                           |
| Cierre automático conserva y bloquea la cola de A          |      1 | Ya en main: `sharedComputerRehearsal.test.ts`.                                                                                                                                                                                                                                                                                                                 |
| Lote clínico durante reemplazo manual/automático           |      2 | Ya convertido en dos contratos positivos en main por #1143.                                                                                                                                                                                                                                                                                                    |
| Extensión: permiso heredado y sesión externa compartida    |      1 | Se conserva la evidencia histórica en este informe; el contrato de revocación ya quedó en main mediante #1147, después de nuestra base. No se añade una prueba que legitime el permiso heredado. La sesión externa compartida no tenía un caso independiente del permiso: queda como límite documentado del montaje, no como falso contrato de identidad real. |
| Extensión: caducidad del permiso a cinco minutos           |      1 | Duplica `tabEncounterAuthorizationSleep.test.ts`, ya en main.                                                                                                                                                                                                                                                                                                  |
| Dos enfermeros: estructura, lote, archivo y lectura        |      2 | Ya en main: `sharedComputerAuthority.emulator.test.ts`.                                                                                                                                                                                                                                                                                                        |
| CUDYR previo rechazado a enfermería                        |      1 | Sustituido en main por contratos positivos A/B y controles negativos de otros roles/campos (#1144).                                                                                                                                                                                                                                                            |
| B escribe/archiva corrida atribuida a A                    |      1 | Bloque defectuoso retirado por #1143; controles de sesión y autoridad vigentes. No se restaura como éxito.                                                                                                                                                                                                                                                     |
| Cuenta pendiente y sesión vencida sin acceso               |      2 | Ya en main: `sharedComputerAuthority.emulator.test.ts`.                                                                                                                                                                                                                                                                                                        |
| **Total original**                                         | **16** | **2 conservados aquí (1 positivo, 1 fallo esperado); 13 ya cubiertos o sustituidos en main, incluido el permiso de #1147 incorporado durante el cierre; 1 duplicado de caducidad.**                                                                                                                                                                            |

La suite nueva vive en `src/tests/services/storage/`, carpeta apta para sus imports
de almacenamiento y diagnóstico. No se modifican las dos suites ya incorporadas
a main ni las pruebas de #1147. La aceptación temporal no prueba
una corrección ni autoriza purgar almacenamiento, compartir credenciales o alterar
la autoría. Esta rama de ensayo puede retirarse tras revisar la consolidación;
la corrección del permiso ya quedó en main mediante su PR independiente. No se borra ninguna rama.
