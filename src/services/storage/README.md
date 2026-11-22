# `src/services/storage`

## Propósito

Capa de persistencia concreta: IndexedDB, localStorage, Firestore y sincronización.

## Puertas

Desde fuera de esta carpeta se entra por `@/services/storage/firestore` (lectura y escritura
remota de registros y catálogos) y `@/services/storage/sync` (cola, reintentos, métricas y
telemetría de sincronización). La sesión vive aparte en `src/services/session/`; la copia local
(`indexeddb/`, `localstorage/`, `localpersistence/`) y la configuración de tablas e interfaz tienen
cada una su archivo; la raíz no tiene barril `index.ts`.

`storage/firestore` es el entrypoint remoto soportado.
La construcción de rangos mensuales y helpers de escritura sigue viviendo en
`firestore/firestoreQuerySupport.ts` y `firestore/firestoreWriteSupport.ts`.
Los flujos de documento único deben preferir `firestore/firestoreDocumentStore.ts`
para centralizar `runtime.ready`, `getDoc/setDoc` y preparación de suscripciones.
`storage/sync` es la fuente soportada para telemetría (`getSyncQueueTelemetry()`), stats (`getSyncQueueStats()`) y operaciones recientes (`listRecentSyncQueueOperations()`).

El motor comparte una sola lectura de contadores mediante su telemetría. Las APIs de
estadísticas agregadas conservan su contrato y aislamiento por sesión en la fachada
pública, sin retener cálculos sin consumidores dentro del motor de envíos.
La telemetría lee los estados vigentes por el índice existente y obtiene los contadores
propios y ajenos en una sola captura, sin recorrer los respaldos retirados.
La fachada pública vive en `sync/publicSyncQueue.ts`.
Sus lecturas comprueban el propietario y la generación de sesión antes de devolver
resultados. Si cambian mientras espera IndexedDB, usan el diagnóstico de lectura
no disponible; una consulta nueva puede recuperar los datos de la sesión vigente.
Las lecturas de operaciones recientes y lotes listos filtran en el cursor de
IndexedDB antes de aplicar el límite. Conservan el orden temporal y los controles
de propietario, espera y lease, sin reunir toda la cola en memoria para recortarla.
El trabajador consulta los rangos `PENDING` y `PROCESSING` del índice existente
`[status+timestamp]`, toma hasta un lote por rango y combina por timestamp e id.
Así no recorre respaldos retirados o tareas en cuarentena para encontrar trabajo
listo. La selección y la reclamación siguen dentro de la misma transacción.
El outbox ahora se arma sobre un engine con puertos (`sync/syncQueueEngine.ts`, `sync/syncQueuePorts.ts`) para separar runtime navegador, store Dexie y transporte Firestore.
`sync/syncDomainPolicy.ts` clasifica tareas por contexto (`clinical`, `staffing`, `movements`, `handoff`, `metadata`) para aplicar budgets de retry y métricas de conflicto más específicas.
`getSyncQueueTelemetry()` puede devolver `readState = unavailable` cuando la cola no puede inspeccionarse;
ese caso debe tratarse como degradación operativa real, no como cola vacía.
`listRecentSyncQueueOperations()` registra el fallo y rechaza la lectura; sólo una
lectura correcta puede devolver una lista vacía. El monitor distingue ese fallo de
los contadores disponibles y lo muestra como «Guardado local · por comprobar».
El reporte de salud conserva los contadores y el evento del fallo aunque no pueda
adjuntar la lista reciente. Una lectura posterior correcta restablece el monitor.

## Estrategia

- Offline-first con IndexedDB.
- Fallback controlado en caso de fallo de DB local.
- Sincronización diferida con Firestore.
- No existe almacenamiento demo soportado en esta capa.
- La UI de fallback intenta primero una recuperación automática de sesión antes de mostrar avisos al usuario.
- Los hooks de estado de fallback pausan el polling cuando la pestaña está oculta para evitar trabajo innecesario.

## Recomendación

Cambios en esta capa requieren:

1. tests de servicios,
2. verificación de degradación/fallback,
3. si tocan `sync/` o `firestore/`, actualizar `reports/operational-health.md`
4. mantener alineados `docs/RUNBOOK_SYNC_RESILIENCE.md`,
   `docs/RUNBOOK_OPERATIONAL_BUDGETS.md` y `npm run check:operational-runbooks`
   cuando cambien budgets, degradación local o criterios de alerta.
   y mantener `storage/firestore`/`storage/sync` como fachadas curadas.

## Contrato y límites

- `storage/firestore` no debe reabsorber helpers de rango, concurrencia o snapshots.
- `storage/firestore/firestoreServiceRuntime.ts` es el adaptador canónico hacia Firestore runtime;
  nuevos servicios de storage/transfers no deben depender directo de `defaultFirestoreRuntime`.
- `storage/firestore/firestoreDatabaseProvider.ts` es el entrypoint canónico para servicios
  repository-style que necesitan el provider Firestore-backed; nuevos consumers no deben entrar
  por `services/infrastructure/db` para obtener el singleton concreto.
- La regla `firestore-runtime` del control de patrones de `src/` (en `check:quality`) rechaza importar
  `firebase-runtime/firestoreRuntime` fuera de `firestoreServiceRuntime.ts` y
  `repositoryFirestoreRuntime.ts`, para que los servicios nuevos entren por esos adaptadores.
- `storage/sync` es el único punto de acceso soportado para telemetría, stats
  y operaciones recientes; la UI no debe leer Dexie directo para esta información.
- `sync/publicSyncQueue.ts` es la implementación canónica del outbox.
- Si cambia la policy domain-aware de sync, deben actualizarse en conjunto:
  - `sync/syncDomainPolicy.ts`
  - `syncQueueTypes.ts`
  - `storage/sync`
  - tests de `syncQueueService` y `sync-resilience`
- Los puertos de `sync/` deben permanecer agnósticos de React/UI.

## Operación

- Runbook soporte sync/resiliencia: `docs/RUNBOOK_SYNC_RESILIENCE.md`
- Budgets y thresholds operativos: `docs/RUNBOOK_OPERATIONAL_BUDGETS.md`
- Los fallos `backing store` de IndexedDB deben tratarse como recuperables: se evita borrar la base
  local de inmediato y se privilegian reintentos en segundo plano antes de exponer fallback persistente.
- Los avisos visibles priorizan lenguaje no técnico y reservan acciones avanzadas solo para casos persistentes.

## Dotación compartida

Los parches de enfermería y TENS, incluidos sus campos heredados y detalle por turno,
comprueban la versión y escriben en una misma transacción de Firestore. Una base
obsoleta genera conflicto y conserva el envío para su conciliación; no confirma
una sustitución silenciosa del cambio de otro equipo (SAVE-01, SAVE-02).
