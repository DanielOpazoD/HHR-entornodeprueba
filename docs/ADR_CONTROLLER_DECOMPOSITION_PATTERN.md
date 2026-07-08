# ADR: Decomposición de Hooks vía Controllers Puros

**Estado:** Vigente

## Decisión

Cuando un React hook crece más allá de **~150 LOC** o concentra
responsabilidades múltiples (validación + side-effects + dispatch a UI +
local state), extraemos la lógica orquestadora a un **controller puro** en
`src/<area>/controllers/<name>Controller.ts` (o donde corresponda según el
boundary del área). El hook queda como **shell delgado de React** que:

1. Lee del contexto de React lo que necesita (`useAuth`, `useNotification`,
   refs, state).
2. Llama al controller puro pasándole esas dependencias.
3. Despacha el outcome devuelto por el controller a setters / notifications.

## Plantilla

```ts
// src/features/<feature>/controllers/<op>SaveController.ts
export type <Op>SaveOutcome =
  | { kind: 'invalid'; message: string }
  | { kind: 'failed_with_message'; message: string }
  | { kind: 'saved'; ...; warnings: string[] };

export const execute<Op>Save = async (
  submission: <Op>Submission,
  context: <Op>Context  // dependencies, no React
): Promise<<Op>SaveOutcome> => { ... };
```

```ts
// src/<area>/use<Op>.ts
export const use<Op> = () => {
  const ctx = useContextDeps();
  const callback = useCallback(async (input) => {
    setProcessing(true);
    try {
      const outcome = await execute<Op>Save(input, ctx);
      switch (outcome.kind) {
        case 'invalid': notify(outcome.message); return false;
        case 'failed_with_message': notify(outcome.message); return false;
        case 'saved': for (const w of outcome.warnings) notify(w);
                     success(); return true;
      }
    } finally {
      setProcessing(false);
    }
  }, [ctx]);
  return callback;
};
```

## Implementaciones de referencia

- **Reminder admin save**:
  - `src/features/reminders/controllers/reminderAdminSaveController.ts`
  - `src/features/reminders/hooks/useReminderAdmin.ts`
- **Medical handoff mutation runner** (caso N handlers comparten pattern):
  - `src/hooks/controllers/medicalHandoffMutationRunner.ts`
  - `src/hooks/useMedicalHandoffHandlers.ts` (9 callbacks colapsados a
    declaraciones)
- **Empty-bed save routing**:
  - `src/features/census/controllers/admitPatientGate.ts`
  - `src/features/census/components/CensusTable.tsx`
- **Transfer package generation**:
  - `src/hooks/controllers/transferPackageGenerationController.ts`
  - `src/hooks/useTransferViewStates.ts`
- **Backup handoff confirm**:
  - `src/hooks/controllers/exportManagerConfirmController.ts`
  - `src/hooks/useExportManager.ts`

## Beneficios verificados en la práctica

- **Tests**: la lógica orquestadora se cubre con tests unitarios sin
  renderizar componentes. Para los 5 ejemplos de arriba, ~30 specs nuevos
  cubren branches que antes solo se ejercitaban indirectamente vía render
  tests más lentos y frágiles.
- **Reuse**: el runner del medical handoff colapsó 9 handlers de ~25 LOC
  cada uno (225 LOC repetitivos) a 9 declaraciones de ~12 LOC + 1 runner
  testeable.
- **Lectura**: el hook lee como un mapa de "qué hace cada acción" en lugar
  de ocho try/catch consecutivos.

## Cuándo NO extraer

- Hook < ~120 LOC con una sola responsabilidad clara.
- Lógica que es 100% React (ej. solo manipula refs / focus / scroll).
- Si la "extracción" es solo mover código sin un cambio de tipo de retorno
  hacia un outcome tagged. La señal de buena extracción: el controller
  retorna un **discriminated union** que el hook switchea.

## Dónde vive el controller

- Si la lógica pertenece a una feature: `src/features/<feature>/controllers/`
- Si es transversal a varios hooks: `src/hooks/controllers/`
- Si pertenece a la capa de aplicación canónica (ver
  [ADR_CANONICAL_WRITE_COMMANDS](ADR_CANONICAL_WRITE_COMMANDS.md)):
  `src/application/<aggregate>/`

## Motivo

Los hooks "monstruo" (>250 LOC, >5 callbacks, >9 useState) se vuelven
dolorosos de leer y casi imposibles de testear sin renderizar el árbol
completo. La extracción a controller puro:

- Separa "qué decide hacer" de "cómo lo despacha en React".
- Hace la primera testeable en milisegundos.
- Hace la segunda trivial de revisar.

## Consecuencia

- En auditorías de tamaño, los hooks ≥150 LOC son candidatos automáticos
  a evaluación de extracción.
- Los nuevos hooks deben nacer pensando en si la lógica orquestadora
  amerita controller desde el día uno.
- No es prescriptivo aplicar el patrón a todo. Si el hook ya está limpio
  y enfocado, mover por mover es overengineering.
