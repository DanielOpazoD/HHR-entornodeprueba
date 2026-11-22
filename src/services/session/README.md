# `src/services/session`

Propietario único del ciclo de vida de la sesión clínica, generación admitida y resguardo de cola al cerrar sesión:

- `authoringSession.ts`: puerta principal (`guardAuthoringSession`, `authoringSessionScope`, `isAuthoringSessionCurrent`).
- `sessionStorageTransition.ts`: generación admitida, época de sesión (`sessionEpochGuard`, `onSessionChange`, `useSessionEpoch`) y emisión del evento de cambio.
- `sessionOwnerKey.ts`: propietario guardado y admitido en esta pestaña (`getTabOwnerKey`).
- `sessionScopedStorageService.ts`: limpieza acotada de almacenamiento efímero por sesión.
- `sessionSyncQueuePreservation.ts`: conservación durable de la cola al cerrar sesión (SAVE-03).

La regla ESLint `session/raw-read` (`scripts/config/session-raw-read-ledger.json`) limita las lecturas crudas de sesión a estos cinco módulos dueños.
