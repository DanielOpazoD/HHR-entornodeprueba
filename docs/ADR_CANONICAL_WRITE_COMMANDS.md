# ADR: Canonical Write Commands para mutaciones clínicas

**Estado:** Vigente

## Decisión

Toda mutación clínica nueva (admit, discharge, transfer y futuros) sigue un
contrato canónico de cinco pasos en `src/application/<aggregate>/commands/`:

1. **Rechazo de actor anónimo** vía `isAnonymousActor(input.actor)` (consistente
   con la política del módulo de auditoría).
2. **Validación determinística** del input (`validate<Op>Input`) que retorna
   `{ ok: true } | { ok: false; field; message }`.
3. **Persistencia inyectable** vía un puerto (`<Op>Port`) con función única
   `persist<Op>(input) => Promise<<Op>Snapshot>`. La capa de application
   no conoce Firestore ni IndexedDB.
4. **Auditoría canónica** vía `executeWriteAuditEvent({ userId, action,
entityType, entityId, details, patientRut, recordDate })`.
5. **Outcome tipado** que retorna `{ status: RuntimeOperationStatusSnapshot;
data: <Snapshot> | null; applicationOutcome: ApplicationOutcome<...> }`,
   con mapeo determinístico de los estados:
   - actor anonymous → `blocked` + `permission`
   - validación falla → `blocked` + `validation`
   - persistencia lanza → `failed` + `unknown`
   - persistencia OK + auditoría falla → `degraded`
   - persistencia OK + auditoría OK → `ready`

## Plantilla canónica

```ts
export const execute<Op>PatientCommand = async (
  input: <Op>PatientInput,
  deps: <Op>PatientCommandDependencies
): Promise<<Op>PatientOutcome> => {
  if (isAnonymousActor(input.actor)) return blockedPermission();
  const validation = validate<Op>PatientInput(input);
  if (!validation.ok) return blockedValidation(validation);

  let snapshot: <Op>PatientSnapshot;
  try {
    snapshot = await deps.port.persist<Op>(input);
  } catch (error) {
    return failed(error);
  }

  const writeAudit = deps.writeAuditEvent ?? executeWriteAuditEvent;
  const auditOutcome = await writeAudit({ ... });
  if (auditOutcome.status === 'failed') return degraded(snapshot, auditOutcome);
  return ready(snapshot);
};
```

## Implementación de referencia

- `src/application/daily-record/commands/admitPatientCommand.ts` (única
  vigente; tiene su puerto en `src/services/daily-record/dailyRecordAdmitPatientPort.ts`
  y su hook adaptador `useAdmitPatient` que resuelve el actor desde
  `useAuth() + resolveAuditActor()`).

Pilots iniciales para `discharge` y `transfer` existieron y demostraron que el
contrato escala más allá de `admit`, pero fueron eliminados (audit
2026-05-03) por no tener callers en producción y duplicar 65-70% del código
con sus adoption facades. La auditoría completa con justificación está en
[AUDIT_2026-05_PILOT_FACADE_OVERLAP.md](AUDIT_2026-05_PILOT_FACADE_OVERLAP.md).
La pipeline de producción de discharge/transfer corre vía adoption facade
(ver [ADR_CANONICAL_WRITE_ADOPTION_FACADES](ADR_CANONICAL_WRITE_ADOPTION_FACADES.md)).

## Cobertura mínima de tests

Cada comando debe tener:

- 1 spec de happy path (`ready`)
- 1 spec de actor anónimo (`blocked` + `permission`)
- 1 spec por cada campo requerido fallando validación (`blocked` + `validation`)
- 1 spec de persistencia que lanza (`failed` + `unknown`)
- 1 spec de auditoría rechazada (`degraded` con `userSafeMessage`)

Plus 1 integration test del hook → port → repository (mock al límite del
repositorio, no más arriba).

## Motivo

Antes de este patrón cada hook clínico mezclaba validación, side-effects,
auditoría y dispatch a UI con estilos divergentes. Eso producía:

- Inconsistencia: algunos rechazaban anónimos, otros no.
- Inobservabilidad: no había distinción semántica entre "rechazado",
  "fallido", "guardado pero sin audit".
- Tests difíciles: side-effects mezclados forzaban a renderizar componentes
  para probar lógica clínica.

## Consecuencia

- Toda mutación clínica nueva debe seguir esta plantilla. Si no calza,
  abrir un activo en el tracker y discutir antes de divergir.
- El patrón vale la pena para escrituras canónicas (admit/discharge/
  transfer). Para mutaciones triviales (`toggleBlockBed`, `clearPatient`)
  basta con retornar `ApplicationOutcome<...>` sin separar puerto + comando.
- Cuando la persistencia legacy es muy rica para encapsularla en un puerto
  simple (caso discharge/transfer en este repo), usar el patrón **adoption
  facade** documentado en
  [ADR_CANONICAL_WRITE_ADOPTION_FACADES](ADR_CANONICAL_WRITE_ADOPTION_FACADES.md).
