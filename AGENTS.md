# Reglas para agentes

Este archivo lo leen Codex y otros agentes. Claude Code lo carga desde [CLAUDE.md](CLAUDE.md).
Vale para cualquier persona o agente que cambie este repositorio.

HHR es la aplicación clínica del Hospital Hanga Roa, en Rapa Nui. Producción trabaja con datos
reales de pacientes.

## Antes de cambiar algo

Este archivo basta para empezar. Lee además **solo** lo que corresponde a lo que vas a tocar;
el resto de `docs/` es de consulta, no lectura previa.

- **Una función que ve el usuario** (un botón, un flujo): su fila en
  [feature-map.json](scripts/config/feature-map.json) dice cómo se llega, la carpeta dueña, la
  puerta de código (la primera es donde vive la decisión) y qué pruebas la acreditan. Abrir el
  día, guardar una celda, sincronizar con Eloísa y la hora de un egreso desde Eloísa tienen
  además `flow`: cada paso en orden, archivo y símbolo.
- **Un texto, un estilo o una constante:** nada más. Si la constante figura en una regla de
  este archivo, actualiza esa regla.
- **Datos clínicos, identidad, hora, guardado, sincronización, sesión o permisos:** la regla,
  por su identificador (ID-01, TIME-02, SAVE-01…) o su tema, en el
  [contrato operativo](docs/DOMAIN_RULES.md). El contrato manda sobre el código y sobre este
  archivo, y guarda el detalle de cada regla de abajo.
- **Algo nuevo o que cambia de lugar** (un módulo, una responsabilidad que se mueve, un cruce
  de features): la [página de arquitectura](docs/architecture.md) (dónde va cada cosa).
- **Un área con diseño propio:** ese diseño en `docs/`; por ejemplo, la fase 1a:
  [DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md](docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md).
- **Un fallo en CI:** el control que falló en
  [CI y recuperación](docs/CI_GATES_AND_FAILURE_RUNBOOKS.md), no el documento entero.
- **Un término del hospital que no entiendes:** ese término en el [glosario](docs/GLOSSARY.md).

Un merge a `main` llega a producción. Netlify publica solo y CI despliega Functions.

## Reglas y qué las hace cumplir

Cada regla dice qué la impone. **[docs]** marca las que solo dependen de que el agente
lea este archivo.

### Datos clínicos

- La identidad es paciente más episodio; la cama es una ubicación, y madre y recién nacido son personas distintas (ID-01 a ID-03). — _Lo impone:_ Pruebas de identidad y de RN
- En los catálogos de enfermería y TENS, nombres que solo difieren en tildes, diéresis, ñ, mayúsculas o espacios son una persona; una cedilla, un grave o un circunflejo los separa, el ID de Eloísa manda sobre la grafía y un nombre de dos personas no elige a ninguna. — _Lo impone:_ `staff-name-fold` en `check-source-patterns`; `staffIdentityFlows.test.tsx`, `staffPreferredName.test.ts`, `StaffSelector.test.tsx`; pruebas de catálogo y concurrencia con emulador (`shared-staff-catalog.emulator.test.ts`)
- Un pasaporte nunca se convierte en RUT ni se compara como RUT, y `/[^0-9kK]/` no se copia fuera de `src/utils/rutUtils.ts` (ID-01). — _Lo impone:_ ESLint `no-restricted-syntax`; `passportRutComparisons.test.ts`, `sourceDocumentWithLetters.test.ts`; **[docs]** para comparaciones nuevas
- «Hoy», la hora y el turno salen del reloj del hospital (Pacific/Easter, `src/utils/clinicalTimeZone.ts`), no del computador, y toda hora con desfase, también la continental, se convierte a Rapa Nui, sin cortarla ni leerla ignorando el desfase (TIME-02). — _Lo impone:_ `npm run check:clinical-clock`; `backupCalendarsHospitalClock.test.tsx`; pruebas de dispositivos y de traspaso
- Un paciente que falta en una fuente parcial o fallida no está dado de alta ni borrado (CEN-01). — _Lo impone:_ Pruebas de egreso y de sincronización
- `nurse_hospital` sincroniza CUDYR con las mismas fechas y caminos que `admin`; `setAdminCudyrResult` sigue siendo solo de administrador. — _Lo impone:_ Pruebas de autoridad y permisos CUDYR: diaria, reenvío y archivo mensual
- La actualización de exámenes del censo muestra su período y acepta Desde/Hasta propios, independientes del día censal. — _Lo impone:_ Pruebas del rango en el servidor; `census-laboratory-inbox.spec.ts`
- MMRAD consulta el portal por Netlify, sin depender del túnel ni de Syslab, y un fallo de sesión nunca significa «sin exámenes». — _Lo impone:_ `mmradService.test.ts`, `mmradLoginFlow.test.ts`, `mmradSearch.test.ts`
- No tocar CUDYR saneado, decisiones manuales, censos verificados ni horas oficiales de egreso de Eloísa (TIME-03, CUD-01). — _Lo impone:_ **[docs]**
- Un dispositivo de Eloísa queda retirado cuando falta en una lectura JSON correcta del día, nunca por su fecha de vencimiento. — _Lo impone:_ `mergeClinicalDeviceRead.test.ts`

### Guardado, sincronización y sesión

- El registro de Entrega de turno admite a administradores con cuenta individual activa y a la cuenta Google institucional protegida. — _Lo impone:_ `nursingHandoffDevice.test.ts` y `nursing-handoff-device.emulator.test.ts`
- Nada borra la cola, los parches pendientes ni el outbox sin confirmación explícita: ni una reparación, cierre de sesión o reinicio, ni su antigüedad o número de fallos (SAVE-03). — _Lo impone:_ Pruebas de arranque y de cola; ESLint `queue/removal-home` para borrados nuevos de la cola o la base local, también por alias `const` o destructuración `const`; **[docs]** para los parches pendientes, quien llama a esos módulos y la tabla tomada con `let` o reasignación, pasada por parámetro, devuelta por una función o guardada en una colección
- Si cambia el propietario o la generación de sesión, una corrida clínica se detiene sin reanudarse ni avisar, conservando lo confirmado y la cola durable; solo se recupera la entrega de turno de enfermería. — _Lo impone:_ Pruebas de cambio y cierre de sesión; `inFlightEditOwnerRetention.test.tsx`; sesión obligatoria en contratos internos (`dailyRecordPort.authoringBoundary.test.ts`); ESLint `session/raw-read`: una operación pregunta con `guardAuthoringSession()` (`authoringSessionGuard.test.ts`); en la salida, CUDYR llega a Functions solo por `callCudyrFunction()` (ESLint `no-restricted-syntax`) y toda salida de la cola actúa solo por quien esta pestaña admitió, `getTabOwnerKey()` (`cudyrSendsAfterHandover.test.tsx`, `queueExitsTabOwner.test.ts`)
- El cambio de sesión de Eloísa se observa solo con `onSessionChange` o `useSessionEpoch` (`src/services/session/sessionStorageTransition.ts`), nunca escuchando `HHR_RAYEN_SESSION_CHANGED`. — _Lo impone:_ ESLint `no-restricted-syntax`; `sessionChangeScope.test.tsx`
- En el reenvío, solo el valor almacenado acredita un campo ya aplicado, y un conflicto real conserva la tarea completa sin escribir. — _Lo impone:_ `offlineReplayEquivalence.emulator-ui.test.ts`
- Una lectura fallida no es «sin datos», tampoco en suscripciones, y una escritura fallida no es «guardado»; un día con escrituras pendientes se lee como el servidor con lo pendiente encima, o no se da por confirmado (SAVE-01). — _Lo impone:_ `npm run check:empty-on-failure-reads` en datos, laboratorio, radiología, paciente/UPC, CUDYR, respaldos, correos, perfiles y salud; `closedNurseWindowRefusalServerRead.emulator-ui.test.tsx` y `pendingDayRead.emulator-ui.test.tsx` (día con pendientes); **[docs]** fuera de ellos
- La decisión manual de especialidad nunca confirma una decisión rechazada ni inventa ausencia local. — _Lo impone:_ `usePatchDailyRecordLocalReadRecovery.test.tsx`; pruebas de especialidad
- Los documentos `clinicalDerived` de la fase 1a los escribe solo el servidor, y `HHR_CLINICAL_DERIVED_SPLIT_FROM` no cambia sin el responsable. — _Lo impone:_ `firestore.rules`; **[docs]**
- El diagnóstico local se atribuye al propietario que esta pestaña admitió en memoria, nunca a la clave compartida. — _Lo impone:_ `localDiagnosticsOwnership.test.tsx`; mutaciones de propietario, rol y envío

### Pruebas y datos reales

- Las pruebas usan solo datos sintéticos y nunca sincronizan con el Firebase de producción ni leen sus datos. — _Lo impone:_ `scripts/lib/firebase-emulator-ci.sh`, `npm run test:emulator:file -- <ruta>`; **[docs]**
- La telemetría puede llevar datos del paciente para diagnosticar, pero nunca excepciones crudas ni credenciales. — _Lo impone:_ `npm run check:secret-leaks` en parte; **[docs]**
- Cada prueba verifica lo que observa quien usa el código, y al borrar código o pruebas ningún comportamiento vigente pierde su última prueba. — _Lo impone:_ **[docs]**

### Código y dependencias

- El código de producción de `src/` no usa `any` explícito. — _Lo impone:_ ESLint `@typescript-eslint/no-explicit-any` (error)
- Ningún archivo de producción de `src/` ni `netlify/functions/` suma un `as unknown as` (su techo por archivo solo baja) ni usa `as never`. — _Lo impone:_ ESLint `types/unknown-cast-ceiling` con `scripts/config/unknown-cast-ceilings.json` y `types/no-never-cast`
- Todo paquete importado está declarado en `package.json`. — _Lo impone:_ `npm run check:declared-dependencies`
- No hay ciclos de imports en tiempo de ejecución. — _Lo impone:_ `npm run check:import-cycles`
- Todo módulo de la app se alcanza desde un punto de entrada, y lo que se conserva sin uso figura con su motivo en `scripts/config/unreachable-modules.json`. — _Lo impone:_ `npm run check:unreachable-modules`
- Un módulo de `src/` depende solo de su capa o de las de abajo en valor y carga diferida (capas en `scripts/folder-dependency-matrix.json`), `components/` no abre datos, `netlify/functions/` solo importa capa 0 de `src/`, y el libro de excepciones solo baja respecto de la base. — _Lo impone:_ `npm run check:folder-dependencies`; `checkFolderDependencies.test.ts`
- Un feature importa otro solo si `scripts/feature-dependency-matrix.json` lo permite, y solo por su superficie pública (`public.ts`, `index.ts` o `publicModulesByFeature`). — _Lo impone:_ ESLint `hhr/feature-boundaries`, `hhr/public-import-boundaries`; `featureBoundaryLint.test.ts`
- Un rol se decide con un predicado con nombre de `src/shared/access` (o una columna de `roleAccessMatrix`), nunca comparando o listando roles a mano. — _Lo impone:_ ESLint `no-restricted-syntax` (rol); tabla de verdad de `operationalAccessPolicy.test.ts`
- Los tipos del dominio se importan de `src/types/domain/*`, y las formas estrechas llevan nombre propio, sin alias puros ni reexportaciones por capa. — _Lo impone:_ `npm run check:repo-hygiene`
- Los módulos de `src/` y `functions/lib/` son cohesivos y tienen como máximo 600 líneas. — _Lo impone:_ `npm run check:module-size`
- Las dependencias de la raíz y de Functions pasan la auditoría sin hallazgos altos ni críticos, y sin excepciones aceptadas. — _Lo impone:_ `scripts/check-dependency-vulnerabilities.mjs` en `security-audit.yml`
- Sin reescrituras, plataformas ni colas nuevas, y un cambio de rendimiento necesita una etapa y una causa medidas. — _Lo impone:_ **[docs]**
- No borrar `Formularios/` ni `Hospital Salvador/`, y preguntar antes de tocar `printables/` o los PNG de la raíz. — _Lo impone:_ `npm run check:repo-hygiene` con `scripts/config/owner-protected-files.json`

### Producción y pull requests

- Las reglas se editan en `rules/`; `firestore.rules` y `storage.rules` se generan y se sobrescriben al correr las pruebas. — _Lo impone:_ `check-rules-generated` en `check:security`
- Desplegar Functions o reglas manualmente, o cambiar la configuración de Netlify, solo si el responsable lo pide. — _Lo impone:_ **[docs]**; desfase: `rules-drift.yml`
- `ci-summary` es el único check requerido y `main` exige ramas al día; no se salta ni se relaja. En `main`, solo acredita sin repetir lo que una corrida de PR completa y verde ya probó con el mismo árbol. — _Lo impone:_ Ruleset de `main`; `ciEvidenceReuse.test.ts`
- Antes del push, `npm run check:changed`; CI del SHA final acredita sus controles, sin duplicar la matriz local (alcance de `npm run test:changed` en [CONTRIBUTING.md](CONTRIBUTING.md), cierre en `docs/CI_GATES_AND_FAILURE_RUNBOOKS.md`). — _Lo impone:_ `.husky/pre-push`; `ci-summary`; **[docs]** para no duplicar
- Un agente mergea directo y sin preguntar sus propias PRs en cuanto están en verde y listas para mergear con `main`, de a una, y no toca las PRs de otros hilos. — _Lo impone:_ Ruleset en parte; **[docs]**
- Antes de decir «listo», comprobar con `gh pr view --json mergeStateStatus` que la PR se puede mergear con `main`, y decir con qué evidencia se probó. — _Lo impone:_ **[docs]**
- Una PR resuelve una sola cosa, sin corregir de paso lo que no se pidió. — _Lo impone:_ **[docs]**
- Commits en inglés (Conventional Commits); títulos y descripciones de PR en español. — _Lo impone:_ **[docs]**
- La extensión se desarrolla en `DanielOpazoD/extensioneloisahhr`; `extension/` es una copia de un commit fijo que se actualiza con `npm run extension:sync`, y cada paquete se identifica por su huella además del número. — _Lo impone:_ `check-extension-source.mjs`; empaquetador del repositorio de la extensión
- Nunca usar `git stash` sin una etiqueta propia, porque el stash se comparte entre worktrees y sesiones. — _Lo impone:_ **[docs]**

### Trabajo con el responsable

- El centro de conflictos es una herramienta interna del administrador: sin ícono en las barras, se abre desde el menú de opciones del censo. — _Lo impone:_ `AppContentChrome.test.tsx`, `CensusConflictQuickAction.test.tsx`, `HandoffView.test.tsx`
- Avanzar sin pedir permiso en lo reversible; preguntar solo ante lo irreversible o lo que decide el responsable. — _Lo impone:_ **[docs]**
- Informar en español claro, sin jerga. — _Lo impone:_ **[docs]**
- Los cuatro cuadros del encabezado del censo van en una fila por defecto en escritorio y portátil; solo las pantallas estrechas reflujan. — _Lo impone:_ CSS del censo; `census-13-inch-visual.spec.ts` en `nightly-census-visual`
- Lo recuperable se resuelve solo y en silencio, se avisa solo lo que una persona debe resolver, y una mejora de sincronización parte de evidencia real y se mide tras publicar. — _Lo impone:_ **[docs]**
- Las actualizaciones rutinarias del censo son silenciosas, sin alertas que desplacen encabezados o filas. — _Lo impone:_ Contrato UI de frescura; `CensusTable.layout-and-actions.test.tsx`
- El cuadro de sincronización y sus diálogos usan un tono sereno de tres niveles desde `syncTone.ts`, sin colores ni palabras de alarma para lo que permite seguir trabajando. — _Lo impone:_ `syncTone.test.ts`, `syncToneWording.test.tsx`, `RayenSyncStatusLine.test.tsx`
- La sesión se cierra tras 1 hora sin uso y la cuenta activa queda visible, porque varias personas se turnan en un mismo computador. — _Lo impone:_ `SESSION_TIMEOUT_MS`; `idleSessionLogout.test.tsx`, `UserMenu.test.tsx`
- No se reabren la ventana de 48 horas de enfermería (`canWriteCensusDay`, SAVE-04) ni el retiro a propósito del endpoint de resumen clínico con IA. Tras el plazo, al leer el servidor el censo muestra lo vigente; una edición de enfermería rechazada por plazo cerrado queda retenida aparte para descartar y no se vuelve a aplicar. — _Lo impone:_ `applyHistoricalCudyr.test.ts`, `firestoreRulesTemporalBoundaries.ts` y `nurse-editing-window.emulator.test.ts` (48 h); un predicado por operación en `censusDayWriteAccessPolicy.ts`, con ESLint `no-restricted-syntax` y `censusDayWriteAccessPolicy.test.ts`; `closedNurseWindowRefusal*.emulator-ui.test.tsx` (lo que se ve tras el plazo); `retired` en `check:serverless-sensitive-coverage` (endpoint)

## Mantener esta lista

- Cuando el responsable corrige a un agente, arreglar el error y agregar aquí la regla en una
  frase; el detalle va al [contrato operativo](docs/DOMAIN_RULES.md).
- Si la regla ya estaba y nada la hacía cumplir, el error es una repetición. En el mismo
  cambio, imponerla al nivel más alto que funcione y actualizar lo que la impone. El orden es:
  arquitectura, tipos, un control cuyo error nombre el arreglo, una prueba.
- Quitar una regla cuando su error ya no puede ocurrir.
- Este archivo pesa como máximo 20.000 bytes (`npm run check:repo-hygiene`), porque cada agente
  lo carga entero. Sin tablas: Prettier las rellena con espacios.
