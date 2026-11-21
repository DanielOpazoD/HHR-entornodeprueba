# `src/services/firebase-runtime`

## Propósito

Exponer adapters delgados para `auth`, `firestore`, `functions`, `storage` y bootstrap de Firebase
sin repartir la inicialización por hooks, servicios o features.

## Piezas principales

- `firebaseConfig.ts`: bootstrap del SDK cliente (app, auth, Firestore y servicios diferidos).
- `firebaseConfigLoader.ts`: carga config y aplica policy de entorno.
- `firebaseServiceBootstrap.ts`: inicializa `app`, `auth` y `db`, con fallback controlado de persistencia.
- `firebaseConfigRuntimeAdapter.ts`: adapter canónico que entrega instancias listas o diferidas.
- `authRuntime.ts`, `firestoreRuntime.ts`, `functionsRuntime.ts`, `storageRuntime.ts`: runtimes mínimos reutilizables.
- `firebaseStartupDiagnostics.ts`: diagnóstico operativo de arranque y degradaciones benignas.
- `firebaseEnvironmentPolicy.ts`: reglas de emuladores, cache y policy de entorno.

## Flujo principal

1. `firebaseConfigLoader` resuelve la configuración disponible.
2. `firebaseServiceBootstrap` inicializa core Firebase y Firestore.
3. `firebaseConfigRuntimeAdapter` queda como punto único para obtener instancias.
4. Los módulos consumidores usan runtimes delgados (`defaultAuthRuntime`, `defaultFunctionsRuntime`, etc.).
5. Los warnings recuperables se degradan a diagnóstico interno antes de llegar a UI.

## Puntos de falla que sí importan

- `authDomain` ausente o inválido: afecta popup/redirect auth y debe revisarse con policy, no con fixes ad hoc en UI.
- persistencia de `auth` degradada: puede caer de `local` a `session` o `memory`, pero no debe bloquear el arranque.
- persistencia de Firestore no disponible: debe degradar a runtime usable sin romper la app.
- emuladores mal configurados: deben quedar visibles en diagnóstico, no como fallas ambiguas en features.

## Reglas

- Features y servicios no deben inicializar Firebase por su cuenta.
- Los consumers deben preferir runtimes/adapters inyectables antes que singletons ocultos.
- El borde Firebase decide disponibilidad técnica; la UI decide solo feedback.
- Fallas recuperables de bootstrap no deben reaparecer como alerts visibles salvo que bloqueen uso real.

## Guías relacionadas

- Runtime y recovery de auth: [docs/ADR_AUTH_RUNTIME_RECOVERY.md](../../../docs/ADR_AUTH_RUNTIME_RECOVERY.md)
- Política Firebase general: [docs/FIREBASE_POLICY.md](../../../docs/FIREBASE_POLICY.md)
- Soporte operativo: [docs/RUNBOOK_SUPPORT_OPERATIONS.md](../../../docs/RUNBOOK_SUPPORT_OPERATIONS.md)

## Checks recomendados

- `npm run typecheck`
- `npx vitest run src/tests/services/firebase-runtime/ src/tests/hooks/useAuthStateSupport.test.tsx`
