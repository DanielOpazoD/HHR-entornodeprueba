# Arquitectura de HHR: dónde va cada cosa

Esta es la única página de arquitectura. Dice cómo se reparte el código de `src/`, qué capa
puede depender de cuál, quién es dueño de cada concepto y dónde va algo nuevo. Los README de
carpeta solo dicen qué va en esa carpeta y guardan su contenido operativo; las decisiones de
cada subsistema están en sus ADR ([índice](DOCUMENTATION_MAP.md)); las reglas clínicas, en el
[contrato operativo](DOMAIN_RULES.md), que manda sobre esta página.

Cada afirmación está marcada:

- **Hoy:** es cierta en `main`. Si un control la hace cumplir, se nombra; si no, dice
  **criterio** y depende de quien revisa.
- **Objetivo:** forma decidida que todavía no se cumple en todo el código (plan W15 de
  arquitectura). No se usa como excusa para mover código fuera de una PR que lo pida.

Ninguna cifra de esta página está escrita a mano: los controles que se nombran dan la medida
vigente.

## Capas y dirección

**Objetivo** (la forma decidida): las capas van de abajo arriba y se depende solo hacia
abajo. Las carpetas ya existen; lo que hoy impone un control se dice después de la tabla.

| #   | Capa                                                                         | Carpetas de `src/`                                      | Puede importar                                                                  |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 0   | Núcleo puro: sin I/O ni React                                                | `types/`, `domain/`, `utils/`, `constants/`, `schemas/` | solo núcleo                                                                     |
| 1   | Servicios: Firestore, IndexedDB, cola, sesión, auth, telemetría, exportación | `services/`                                             | núcleo                                                                          |
| 2   | Casos de uso compartidos y puertos                                           | `application/`                                          | servicios y núcleo                                                              |
| 3   | Estado React compartido                                                      | `hooks/`, `context/`                                    | capas 0 a 2                                                                     |
| 4   | UI compartida                                                                | `components/`                                           | capas 0 a 3; la UI no lee datos por repositorios                                |
| 5   | Áreas del producto                                                           | `features/<área>/`                                      | capas 0 a 4; otra área solo por su superficie pública y si la matriz lo permite |
| 6   | Composición: arranque, rutas, vistas perezosas                               | `app-shell/`, `views/`, `App.tsx`, `index.tsx`          | todo                                                                            |

`shared/` y `config/` son transversales: `shared/contracts` guarda contratos puros (como
`ApplicationOutcome` y los contratos HTTP con Netlify en `shared/contracts/serverless.ts`),
`shared/runtime` los adaptadores del navegador y `shared/access` los permisos. **Objetivo:**
repartir `shared/` en núcleo, servicios y UI, y llevar `views/` y `config/` a `app-shell/`.

Qué de la tabla impone hoy un control:

- **Hoy:** [`scripts/folder-dependency-matrix.json`](../scripts/folder-dependency-matrix.json)
  (`npm run check:folder-dependencies`) da reglas a `features`, `components`, `hooks`,
  `context`, `services` y `domain`. No tiene lista de excepciones. Las demás carpetas, incluida
  `application/`, no tienen regla: su dirección es **criterio**.
- **Hoy:** `hooks/`, `components/`, `services/`, `context/` y `domain/` no importan un área
  por el alias `@/features/…` (ESLint `hhr/public-import-boundaries`). Sí la alcanzan a través
  de `application/census/public.ts`, la única puerta registrada hacia el interior del censo
  (`GOVERNED_APPLICATION_PUBLIC_IMPORTS` en `scripts/lib/publicImportBoundaryRule.mjs`).
  Hay dependencias hacia arriba que ningún control detecta todavía, por ejemplo de
  `services/` y `schemas/` hacia `application/` y `services/`.
- **Hoy:** no hay ciclos de imports en ejecución (`npm run check:import-cycles`).
- **Objetivo:** una sola regla de carpetas que imponga la dirección de esta tabla a todas las
  carpetas, distinga dependencias de tipos, de valor y de carga diferida, y registre cada
  excepción como una relación concreta en un libro que solo baja. Esa regla reemplazará la
  clasificación de `eslint-plugin-boundaries` de `eslint.config.js` cuando demuestre que cubre
  lo que esta cubre.

## Reglas

1. **Un área entra a otra solo por su superficie pública** (`public.ts`, `index.ts` o una
   entrada liviana declarada en `publicModulesByFeature`) y solo si
   [`scripts/feature-dependency-matrix.json`](../scripts/feature-dependency-matrix.json) lo
   permite. **Hoy:** ESLint `hhr/feature-boundaries` y `hhr/public-import-boundaries`, con
   `featureBoundaryLint.test.ts`. Dentro de un área se usan imports relativos; el alias
   `@/features/<área>` queda para quien está fuera.
2. **Lo que usa una sola área vive en ella** (pantallas, hooks, controladores, casos de uso y
   servicios propios) y pasa a una capa compartida con el segundo consumidor real. **Hoy:**
   criterio; hay módulos compartidos con un solo consumidor que todavía no se movieron.
   **Objetivo:** un informe de pertenencia que abre una revisión del dueño; no ordena mover.
3. **La UI no lee ni escribe datos por repositorios ni infraestructura:** entra por un caso de
   uso o un puerto de `application/`, y los resultados llegan tipados (`ApplicationOutcome`).
   **Hoy:** ESLint `no-restricted-imports` en `components/layout`, `features/cudyr` y
   `features/handoff`; `hhr/feature-boundaries` exige el puerto para
   `ClinicalDocumentRepository` y `censusEmailService`. En el resto, criterio.
4. **Un concepto, un dueño y una puerta** (tabla de abajo). Fuera del dueño no se repite la
   decisión. **Hoy:** impuesto para RUT y pasaporte, clave de episodio, mensaje de sesión
   (ESLint `no-restricted-syntax`), reloj clínico (`npm run check:clinical-clock`), runtime de
   Firestore y permisos heredados (`npm run check:source-patterns`). En el resto, criterio.
5. **Controladores y hooks no importan implementaciones de componentes**, y fuera de
   `DailyRecordContext` se usan las acciones acotadas del registro diario. **Hoy:**
   `npm run check:architecture`.
6. **Los tipos del dominio viven en `src/types/domain/*`**, se importan desde ahí y las formas
   estrechas llevan nombre propio, sin alias ni reexportaciones. **Hoy:**
   `npm run check:repo-hygiene`.
7. **Una copia cliente/servidor es deliberada solo si una prueba de paridad la ata.**
   **Hoy:** criterio.
8. **Simplificar antes de añadir.** Una capa, wrapper o módulo nuevo necesita una
   responsabilidad, un efecto o un contrato propio; no hace falta controlador, caso de uso,
   puerto y repositorio para cada función. Se borra el código sin consumidores comprobados,
   pero la compatibilidad con datos, roles y sesiones históricos es protección activa: no se
   retira por antigüedad aparente. **Hoy:** criterio.
9. **Mover un archivo o carpeta** se hace con
   `node scripts/move-modules.mjs --check <origen> <destino>` (sin `--check`, mueve): reescribe
   imports, `vi.mock`, configuraciones y documentos, y lista para revisar a mano las carpetas
   que dejan de contener lo movido (cobertura, chunks, globs).

## Dueño y puerta por concepto

| Concepto                                             | Dueño (hoy)                                                                                                                | Puerta que usa el resto                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Registro diario: leer, guardar, conflicto, confirmar | `services/repositories` (servicio por operación) con `services/storage` como interior                                      | puerto `application/ports/dailyRecordPort`; en React, `useDailyRecord*` y `DailyRecordContext` |
| Cola de sincronización                               | `services/storage/sync`                                                                                                    | `@/services/storage/sync`; la UI no lee Dexie directo                                          |
| Firestore                                            | `services/storage/firestore`, `services/firebase-runtime`                                                                  | `firestoreServiceRuntime.ts` o `repositoryFirestoreRuntime.ts`                                 |
| Sesión: propietario, generación, cambio              | `services/storage/sessionStorageTransition.ts`, `services/storage/authoringSession.ts` (**objetivo:** `services/session/`) | `captureAuthoringSession` / `isAuthoringSessionCurrent`, `onSessionChange`, `useSessionEpoch`  |
| Reloj, día clínico y turno                           | `utils/clinicalTimeZone.ts`, `utils/clinicalDayScheduleUtils.ts`                                                           | `utils/clinicalDayUtils.ts`; nunca `new Date()` local                                          |
| Plazo de 48 h para días anteriores                   | cálculo temporal en `utils/clinicalWallClock.ts`                                                                           | el predicado de cada operación conserva su regla (no es una sola pregunta)                     |
| Identidad: RUT, pasaporte, episodio                  | `utils/rutUtils.ts`, `application/patient-flow/clinicalEpisode.ts`                                                         | las mismas                                                                                     |
| Permisos y roles                                     | `shared/access/*` y `utils/permissions.ts` (**objetivo:** un solo dueño)                                                   | `shared/access/operationalAccessPolicy.ts`                                                     |
| Telemetría                                           | `services/observability`                                                                                                   | sus adaptadores por dominio                                                                    |
| Efectos del navegador                                | `shared/runtime`                                                                                                           | `browserWindowRuntimeCore`, `browserClipboardRuntime`                                          |
| Eloísa, CUDYR, correo del censo, documentos clínicos | su área en `features/`, más `services/cudyr` y Functions para CUDYR                                                        | el `public.ts` del área                                                                        |

## Si vas a agregar X, va en Y

| Vas a agregar…                                                                   | Va en…                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Una pantalla, botón o flujo de un área                                           | `features/<área>/components`, `hooks` o `controllers`                        |
| Una regla pura de un área / de dos o más                                         | `features/<área>/domain` / `domain/<concepto>`                               |
| Lectura o escritura de datos (red, Firestore, IndexedDB) de un área / compartida | los servicios del área / `services/<concepto>`                               |
| Un caso de uso que combinan dos o más áreas, o un puerto                         | `application/<concepto>` o `application/ports`                               |
| Estado React que usan varias áreas                                               | `hooks/` o `context/`                                                        |
| Un componente visual reutilizado, sin datos                                      | `components/ui` o `components/shared`                                        |
| Una ruta, una vista perezosa o algo del arranque                                 | `app-shell/` o `views/LazyViews.ts` (solo superficies públicas)              |
| Un tipo del dominio                                                              | `src/types/domain/*`                                                         |
| Un contrato HTTP compartido con Netlify                                          | `shared/contracts/serverless.ts`                                             |
| Fecha, hora, turno, «hoy»                                                        | la puerta del reloj (tabla de arriba)                                        |
| RUT o pasaporte                                                                  | `utils/rutUtils.ts`                                                          |
| «¿Sigue siendo mi sesión?» después de un `await`                                 | `AuthoringSession`                                                           |
| Un permiso                                                                       | un predicado de `shared/access`                                              |
| Una prueba                                                                       | `src/tests/`, de preferencia con la misma ruta del código                    |
| Un control                                                                       | primero ESLint o un control existente; un script nuevo solo si ninguno sirve |

Dos casos se solapan; manda esta precedencia:

- **Puerto de aplicación o servicio del área.** El contrato (el puerto) es del caso de uso
  que lo exige; la implementación con I/O vive en servicios y se conecta donde se compone la
  aplicación (`RepositoryContext` o el proveedor del área). Ni la implementación entra al
  puerto ni el puerto a `services/`. Las pruebas siguen inyectando el puerto. Ejemplo:
  `application/ports/prescriptionPort.ts` lo usan solo los casos de uso de recetas; si hace
  falta separar contrato e implementación, se separan ahí.
- **Estado React del registro diario o acciones de un área.** El día, su escritura y sus
  guardas tienen una sola fuente: `useDailyRecord*` y `DailyRecordContext`. Censo, entrega y
  CUDYR leen el mismo día. Una acción propia de un área se compone en el proveedor de esa
  área, no en el registro diario global. **Hoy:** `hooks/useDailyRecordDomainModules.ts`
  todavía arma acciones de camas, altas, traslados, CMA, personal y entrega. **Objetivo:**
  que cada área componga las suyas.

## Áreas

Una fila por carpeta de `src/features/`; `featureBoundaryLint.test.ts` falla si falta o sobra
una. De quién puede depender cada área lo dice `scripts/feature-dependency-matrix.json`, no
esta tabla.

| Área                                                                  | Qué hace para el hospital                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `admin/`                                                              | Panel del administrador: cuentas y roles, auditoría, salud del sistema y mantenimiento de datos             |
| [`analytics/`](../src/features/analytics/README.md)                   | Estadísticas MINSAL/DEIS, CUDYR por nivel de cuidado y traslados, en la ruta `/statistics`                  |
| `audit-documents/`                                                    | Descarga en ZIP los informes oficiales de Eloísa de una lista de RUT, para auditorías                       |
| `auth/`                                                               | Pantalla de ingreso: cuenta Google y acceso de enfermería                                                   |
| [`backup/`](../src/features/backup/README.md)                         | Explorar, guardar, revisar y mantener los respaldos históricos                                              |
| [`census/`](../src/features/census/README.md)                         | Censo diario: camas, pacientes, ingresos, altas, traslados y turnos. Núcleo de la aplicación                |
| [`clinical-documents/`](../src/features/clinical-documents/README.md) | Epicrisis, evoluciones e informes médicos del episodio: borrador, guardado automático, impresión y PDF      |
| [`clinical-library/`](../src/features/clinical-library/README.md)     | Botón «Documentos» del censo: formularios para completar, protocolos, infografías y herramientas clínicas   |
| [`cudyr/`](../src/features/cudyr/README.md)                           | Categorización CUDYR de enfermería: registro, exportación e impresión para la entrega nocturna              |
| `document-scanner/`                                                   | Escanea documentos con el teléfono a PDF; quedan en una bandeja temporal hasta confirmar su carga en Eloísa |
| [`handoff/`](../src/features/handoff/README.md)                       | Entrega de turno de enfermería y planilla de entrega médica en Drive                                        |
| [`laboratory/`](../src/features/laboratory/README.md)                 | Exámenes del paciente: visor de Syslab, informes originales de Exalab y bandeja de exámenes del censo       |
| `prescriptions/`                                                      | Respaldo fotográfico de recetas por cama: carga con QR y PIN, visor y administración                        |
| [`rayen-import/`](../src/features/rayen-import/README.md)             | Sincroniza el censo con Eloísa mediante la extensión; los cambios de camas se aplican tras confirmarlos     |
| `rayen-manual-import/`                                                | Ingresa en una cama vacía un paciente copiado de Eloísa con un código, avisando si ya está en el censo      |
| [`reminders/`](../src/features/reminders/README.md)                   | Avisos que jefatura o administración publican para el personal clínico                                      |
| `whatsapp/`                                                           | WhatsApp: turnos de pabellón, plantillas de mensajes y configuración                                        |
| [`wound-care/`](../src/features/wound-care/README.md)                 | Registro fotográfico de curaciones de heridas, con consentimiento, desde la entrega de enfermería           |

Dentro de un área se usan, según haga falta, `components/`, `hooks/`, `controllers/` (lógica
pura), `domain/` (reglas y contratos propios), `services/` (datos del área) y `types/`.
`features/rayen-import` tiene esa forma completa y sirve de modelo.

## El registro diario

**Lectura.** La UI lee por `useDailyRecordQuery` y `useDailyRecordSyncQuery`, que usan el
puerto `dailyRecord`; los servicios de lectura y sincronización de `services/repositories`
eligen entre la copia local y la remota, y TanStack Query publica el resultado. Firestore es
la autoridad remota, IndexedDB guarda la copia local y los cambios pendientes, y la caché de
consultas alimenta la interfaz: son tres responsabilidades, no tres autoridades. Una lectura
remota más antigua, un `null` transitorio o una lectura fallida no borran una copia válida ni
un cambio pendiente, y no son «sin datos» (SAVE-01).

**Escritura.** Una acción clínica llama a un hook o comando existente, que pasa por el puerto
a `dailyRecordRepositoryWriteService`; ahí se valida, se comprueba la concurrencia y se elige
la autoridad según el tipo de comando. No hay una regla universal de «guardar primero local y
luego remoto»: cada comando conserva su política de confirmación, copia local y cola, y su
resultado llega hasta quien lo pidió. Una proyección optimista
(`usePatchDailyRecordMutation`) no es una confirmación del servidor. Las rutas, guardas y
límites están en [SYNC_CONCURRENCY_MODEL.md](SYNC_CONCURRENCY_MODEL.md); la precedencia, en
[Daily Record Runtime Path](ADR_DAILY_RECORD_RUNTIME_PATH.md) y
[Daily Census Truth Contract](ADR_DAILY_CENSUS_TRUTH_CONTRACT.md).

**En React.** Un componente lee el fragmento más estrecho que le sirve:
`useDailyRecordBeds`, `useDailyRecordStaff`, `useDailyRecordMovements`,
`useDailyRecordStability` o `useDailyRecordStatus`, y dispara acciones con
`useDailyRecord{Bed,Movement,Staff,Day,Cudyr,Handoff}Actions`, que no cambian de identidad.
`useDailyRecordData` se vuelve a pintar con cada cambio del día: solo para quien necesita el
registro completo. `applyPatches` (`utils/patchUtils.ts`) conserva la identidad de las camas
que no cambiaron, por eso `React.memo` en las filas evita trabajo.

## Lo retirado: no recrear

`src/infrastructure/`, la fachada `DailyRecordRepository`, los barriles `index.ts` de
`services/repositories` y `services/storage`, los agregadores `dailyRecordDomainServices` y
`dailyRecordWriteSupport`, la fachada `browserWindowRuntime` y el barril `HandoffRowCells`.
Si alguno hace falta de nuevo, primero una decisión escrita que diga qué responsabilidad tiene.

## Más detalle

- [Vistas C4](architecture/c4/README.md): contexto, contenedores y componentes, como foto de
  un commit fijo.
- Decisiones por subsistema: [censo](ADR_DAILY_RECORD_RUNTIME_PATH.md),
  [auth](ADR_AUTH_RUNTIME_RECOVERY.md),
  [documentos clínicos](ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md),
  [entrega](ADR_HANDOFF_RUNTIME_SURFACES.md), [repositorios](../src/services/repositories/README.md)
  y [almacenamiento y cola](../src/services/storage/README.md).
- Cómo cambiar y probar: [CONTRIBUTING.md](../CONTRIBUTING.md); controles de capas juntos:
  `npm run check:quality:group -- boundaries`.
