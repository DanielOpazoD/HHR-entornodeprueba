# Entrega de enfermería durante cambios de sesión — 01-11-2026

Rama: `claude/logout-keeps-nursing-handoff-20261101`.
Base de `origin/main`: `e28343c6a14923780d26314a7579b027f7ff4347`.
Reglas conservadas: SAVE-01, SAVE-02 y SAVE-03. Datos exclusivamente sintéticos.

## Reconocimiento y alcance

La clasificación utiliza únicamente `UPDATE_DAILY_RECORD` y las rutas explícitas
de `syncContract.changedPaths` que escribe la entrega de enfermería. Incluye notas
de cama y cuna (personas y episodios separados), novedades, los tres checklist y
las listas de responsables de turno de `domain/handoff/management.ts`.

No se infiere una edición desde el contenido del payload ni desde el contexto
`handoff`, que también incluye entrega médica. Una tarea antigua con `*`, una cama
completa o sin detalle por campo no puede clasificarse con certeza; queda como
antes, sin diálogo, aviso ni reenvío por este flujo. Tampoco se adoptan tareas sin
propietario. Los envíos retirados siguen siendo respaldos, nunca confirmaciones.

El cierre manual usa un intento máximo de diez segundos antes de limpiar la
sesión. Si falta confirmación, ofrece Reintentar, Descargar copia y salir y
Cancelar; sin red llega directamente a esa decisión. El automático intenta lo
mismo y continúa conservando el envío. Se mantienen las ocho y doce horas.

Al volver A se reintentan sólo sus rutas de enfermería retenidas por cierre de
sesión, incluidos los fallos de red cuya proyección se liberó al salir. Los
conflictos y errores de validación siguen en revisión. El censo remoto aporta el resto de los valores; se conserva la base de
versión/revisión y la protección de paciente/episodio. Un conflicto permanece en
la revisión existente. En un envío mixto se confirma únicamente enfermería y el
resto queda retenido con su payload original. Una entrega pura conserva su id de
mutación; un subconjunto mixto tiene su propio id estable. La confirmación de una
mutación compactada exige que todos sus valores se hayan aplicado.

Antes de publicar se vuelven a comprobar propietario, generación y actor Firebase,
también después de cargar módulos. B recibe un aviso único con la identidad de A,
sin contenido clínico; nunca se envía ni reasigna su tarea bajo B. Un envío que ya
salió con A puede confirmar en el servidor después del plazo: el cierre conserva
la copia y su posterior reintento usa idempotencia, sin fingir un ACK local.

## Evidencia local

- Node 22.22.2; dependencias instaladas con `npm ci`, sin cambiar los lockfiles.
- Corrida final: **573 casos aprobados en 56 suites**, 47,99 segundos.
- Volumen de respaldos, ejecutado solo: **2 casos aprobados en una suite**,
  5,57 segundos. Se conservan las aserciones y el límite original de 30 segundos.
- Total sin duplicar casos: **575 en 57 suites**, incluidos **40 casos nuevos**.
- Ambos `tsc`, ESLint completo, `check:test-governance`, `check:module-size`
  (máximo 600), `check:import-cycles` (0 ciclos), `check:storage-context-boundaries`
  y `check:application-port-boundary` aprobados. El commit vuelve a ejecutar su
  hook obligatorio de tipos, secretos y archivos staged.
- Build final y `check:bundle-budget` aprobados: **251 archivos y 4909,4 KiB**
  de un máximo de **4928,5 KiB**; shell autenticado **616,8 KiB** de **619,7 KiB**.
  No se modificaron presupuestos ni exclusiones. `dist/` se retira después de verificar.

La primera corrida amplia encontró el cierre síncrono del menú, corregido. La
prueba de volumen excedió su plazo durante corridas concurrentes y luego pasó
sola. Se ajustó el fixture de autenticación de las pruebas de aislamiento para
representar a A autenticado de verdad en el runtime sintético. Dos aserciones de
payload ahora inspeccionan el primer argumento del transporte, conservando su
comprobación de contenido después de añadir el callback de sesión. La corrida
final anterior acredita esos ajustes; no se retiró ninguna prueba.

Reproducción de los casos nuevos:

```sh
npx vitest run src/tests/services/storage/nursingHandoffSession.test.ts src/tests/services/storage/nursingHandoffRecoveryTransport.test.ts src/tests/components/useNursingHandoffLogout.test.tsx src/tests/components/UserMenu.test.tsx src/tests/services/storage/sessionLogoutQueueFencing.test.ts src/tests/services/storage/dailyRecordAuthorityLostResponse.test.ts --maxWorkers=1
```

La corrida de 56 suites también incluyó todas las `syncQueue*`, `sessionLogout*`,
`sessionSyncQueuePreservation`, `dailyRecordTaskRetirement`, las suites de auth
`useAuthState*`, inactividad y sesión individual, `AuthContext`, el menú y
`RayenSyncQueueDetails`, y los contratos del cliente de autoridad. La suite
`syncQueueTelemetryMaterialization` se excluyó únicamente de esa corrida porque
se acreditó por separado con el mismo código de producción pertinente.

## Límites de la evidencia

Las pruebas ejecutan IndexedDB con fake-indexeddb, el motor, la preservación, el
ACK y el transporte real de la aplicación; se simulan las fronteras de Firebase
y las respuestas de autoridad. Las pruebas React usan JSDOM. No acreditan Chrome
real compartido, Auth/Firestore emulados, HTTP, App Check, el despliegue ni el
comportamiento offline del service worker en un navegador instalado. No se leyó
ni escribió Firebase de producción y no se desplegó nada. No se abrió PR ni se
acreditó la matriz CI completa. La rama queda para revisión del responsable.

## Archivos del cambio

- `docs/AUTH_ACCESS_MODEL.md`
- `docs/testing/NURSING_HANDOFF_LOGOUT_20261101.md`
- `src/components/layout/NursingHandoffLogoutDialog.tsx`
- `src/components/layout/NursingHandoffSessionNotice.tsx`
- `src/components/layout/UserMenu.tsx`
- `src/components/layout/UserMenuPanel.tsx`
- `src/context/AuthContext.tsx`
- `src/hooks/useAuthState.ts`
- `src/hooks/useNursingHandoffLogout.ts`
- `src/services/storage/firestore/dailyRecordAuthorityCallableClient.ts`
- `src/services/storage/firestore/dailyRecordAuthorityTransport.ts`
- `src/services/storage/sync/browserSyncRuntime.ts`
- `src/services/storage/sync/dailyRecordTaskRetirement.ts`
- `src/services/storage/sync/dexieSyncQueueAuthorityAck.ts`
- `src/services/storage/sync/dexieSyncQueueStore.ts`
- `src/services/storage/sync/firestoreSyncTransport.ts`
- `src/services/storage/sync/nursingHandoffSession.ts`
- `src/services/storage/sync/nursingHandoffTasks.ts`
- `src/services/storage/sync/publicSyncQueue.ts`
- `src/services/storage/sync/syncQueueEngine.ts`
- `src/services/storage/sync/syncQueuePorts.ts`
- `src/services/storage/syncQueueTypes.ts`
- `src/tests/components/UserMenu.test.tsx`
- `src/tests/components/useNursingHandoffLogout.test.tsx`
- `src/tests/services/storage/dailyRecordAuthorityLostResponse.test.ts`
- `src/tests/services/storage/nursingHandoffRecoveryTransport.test.ts`
- `src/tests/services/storage/nursingHandoffSession.test.ts`
- `src/tests/services/storage/sessionLogoutQueueFencing.test.ts`
- `src/tests/services/storage/syncQueueAuthorityAck.test.ts`
- `src/tests/services/storage/syncQueueFunctionsRecovery.test.ts`
