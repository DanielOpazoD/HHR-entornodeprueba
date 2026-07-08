# ADR: Adoption Facades para migrar pipelines legacy al contrato canónico

**Estado:** Vigente

## Contexto

El patrón canónico definido en
[ADR_CANONICAL_WRITE_COMMANDS](ADR_CANONICAL_WRITE_COMMANDS.md) asume que
la persistencia se puede encapsular en una función de puerto pequeña
(`persist<Op>(input) => Promise<Snapshot>`). Funciona limpio para `admit`
porque escribir una admisión es básicamente un patch parcial sobre `beds.<bedId>`.

`discharge` y `transfer` no calzan: cada uno escribe una **entrada rica** en
arrays (`discharges[]` / `transfers[]`) con metadata de movimiento
(`movementDate`, `dischargeType`, `cribStatus`, `target`, `originalData`,
`isNested`, `escort`, `centerOther`, etc.) y además clearea la cama, todo
gobernado por `usePatientDischarges.addDischarge` /
`usePatientTransfers.addTransfer`. Re-implementar esa lógica dentro de un
puerto del comando duplicaría la pipeline existente y multiplicaría la
superficie de bugs en el corto plazo.

## Decisión

Cuando la persistencia legacy es rica y estable, **NO** la duplicamos en un
puerto. Definimos un **facade de adopción** en
`src/features/<feature>/controllers/<op>CanonicalAdoptionController.ts`
que envuelve el legacy con el contrato canónico:

```ts
export const dispatchCanonical<Op> = async (input, deps): Promise<Outcome> => {
  if (isAnonymousActor(input.actor)) return blocked('permission', ...);
  if (!validateInput(input)) return blocked('validation', ...);

  try {
    await input.performLegacyPersist();   // ← legacy unchanged
  } catch (error) {
    return failed(error);
  }

  const auditOutcome = await writeAudit({ action, ... });
  if (auditOutcome.status === 'failed') return degraded(...);
  return ready(input.entry);
};
```

El facade aporta exactamente las tres cosas del contrato canónico que no
duplican la pipeline:

1. Anonymous-actor rejection.
2. Outcome tipado (RuntimeOperationStatus + ApplicationOutcome).
3. Auditoría canónica vía `writeAuditEventUseCase` (la legacy
   `logDischargeEntries` / `logTransferEntry` se vuelve no-op vía flag).

## Mecanismo de adopción gateado

La integración va detrás de un feature flag dedicado por operación
(`USE_DISCHARGE_PATIENT_COMMAND`, `USE_TRANSFER_PATIENT_COMMAND`). Cuando
el flag está OFF (default), el flujo es idéntico al pre-facade. Cuando ON,
el modal enruta vía el facade y la auditoría legacy se silencia.

`src/hooks/usePatientMovementAudit.ts` chequea el flag al disparar
`logDischargeEntries`/`logTransferEntry` y retorna sin emitir cuando está
ON (el facade ya emitió el audit canónico). Esto evita auditorías duplicadas
sin cambiar la API del hook.

## Implementaciones de referencia

- `src/features/census/controllers/dischargeCanonicalAdoptionController.ts`
- `src/features/census/controllers/transferCanonicalAdoptionController.ts`
- Integración: `src/features/census/hooks/useCensusDischargeCommand.ts`,
  `src/features/census/hooks/useCensusTransferCommand.ts`

## Cuándo usar facade vs comando canónico

| Caso                                         | Patrón                                                      |
| -------------------------------------------- | ----------------------------------------------------------- |
| Mutación nueva sin pipeline legacy rica      | Comando canónico + puerto (template: `admitPatientCommand`) |
| Mutación con pipeline legacy estable y rica  | Adoption facade                                             |
| Pipeline legacy frágil que toca refactorizar | Caso por caso (diseñar)                                     |

## Motivo

Encarar la migración como "expandir el puerto canónico para cubrir todo lo
que hace el legacy" produciría un sprint largo, un PR enorme y riesgo alto
de regresión. El facade entrega el 80% del valor (anon, outcome, audit
canónico) con el 20% del costo y se rolea con flag para que el rollback
sea trivial.

## Consecuencia

- El facade es la **superficie de producción** para discharge/transfer:
  thin, enfocada solo en lo que el legacy no cubre.
- Los pilots iniciales `dischargePatientCommand` y `transferPatientCommand`
  fueron eliminados (audit 2026-05-03) por duplicar 65-70% del código del
  facade sin tener callers reales. La única referencia viva del patrón
  canónico es `admitPatientCommand`. Si en el futuro se necesita reanimar
  un pilot canónico para discharge/transfer (porque el legacy se retira),
  copiar de `admit`: el costo es ~1h, el ADR canónico contiene la
  plantilla completa.
- El flag default OFF significa que el facade está mergeado pero **no
  activo**. Activación requiere E2E manual + flip explícito.
- Si en el futuro la pipeline legacy se decide retirar, hay que migrar la
  persistencia a un puerto canónico nuevo y eliminar el facade — no al
  revés.
