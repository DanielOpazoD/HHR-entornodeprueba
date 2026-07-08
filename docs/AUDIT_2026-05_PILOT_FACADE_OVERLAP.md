# Audit 2026-05 — Solapamiento Pilot vs Facade (discharge / transfer)

**Estado**: Análisis. Sin cambios de código.
**Acción que informa**: decisión binaria sobre eliminar o promover los canonical pilots (C3 del plan de remediación).

## Hallazgo

Los pilots canónicos (`dischargePatientCommand`, `transferPatientCommand` en
`src/application/daily-record/commands/`) y los facades de adopción
(`{discharge,transfer}CanonicalAdoptionController` en
`src/features/census/controllers/`) duplican **el contrato canónico** —
los 5 pasos de `ADR_CANONICAL_WRITE_COMMANDS`. Solo difieren en
**cómo persisten**.

### LOC

| Archivo                                            | LOC     |
| -------------------------------------------------- | ------- |
| `dischargePatientCommand.ts` (pilot)               | 198     |
| `dischargeCanonicalAdoptionController.ts` (facade) | 164     |
| `transferPatientCommand.ts` (pilot)                | 199     |
| `transferCanonicalAdoptionController.ts` (facade)  | 131     |
| **Total**                                          | **692** |

### Bloques idénticos o near-identical

Comparando por sección de código (no comentarios):

| Bloque                                                   | Pilot     | Facade    | Idénticos                                                            |
| -------------------------------------------------------- | --------- | --------- | -------------------------------------------------------------------- |
| Imports (`isAnonymousActor`, factories, status snapshot) | 5 imports | 5 imports | **Sí**                                                               |
| Anon rejection (return `blocked` + `permission`)         | 8 LOC     | 8 LOC     | **Sí** (mismo mensaje, misma factory)                                |
| Validation rejection (return `blocked` + `validation`)   | 10 LOC    | 8 LOC     | **Casi** (pilot valida campos, facade valida `entries.length === 0`) |
| Try/catch persistencia → `failed` + `unknown`            | 12 LOC    | 12 LOC    | **Sí** (estructura idéntica, mensaje en español equivalente)         |
| Auditoría con `executeWriteAuditEvent`                   | 12 LOC    | 12-15 LOC | **Casi** (facade itera sobre entries, pilot single shot)             |
| Degraded mapping cuando audit falla                      | 10 LOC    | 12 LOC    | **Casi** (mismo `userSafeMessage`, misma factory)                    |
| Ready return                                             | 4 LOC     | 4 LOC     | **Sí**                                                               |

**Overlap estimado: 65-70% del código del pilot está replicado en el facade**
con variación mínima. Las únicas diferencias funcionales:

1. El pilot usa **inyected port** (`deps.port.persistDischarge`); el facade usa **caller-provided callback** (`input.performLegacyPersist`).
2. El pilot maneja **single snapshot**; el facade maneja **arreglo de entries** (caso "target=both" en discharge).
3. El pilot tiene **validate per field** explícito; el facade solo valida "hay al menos 1 entry" / "destination no vacío".

### Tests

| Suite                                                                | Specs        | Cobertura del flujo canónico                    |
| -------------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| `tests/application/daily-record/dischargePatientCommand.test.ts`     | 12           | anon, valid, happy, persist throws, audit fails |
| `tests/integration/dischargePatientCommand.integration.test.tsx`     | 3            | hook → port → repo                              |
| `tests/features/census/dischargeCanonicalAdoptionController.test.ts` | 5            | anon, empty, happy, persist throws, audit fails |
| `tests/application/daily-record/transferPatientCommand.test.ts`      | 12           | mismo set                                       |
| `tests/integration/transferPatientCommand.integration.test.tsx`      | 3            | hook → port → repo                              |
| `tests/features/census/transferCanonicalAdoptionController.test.ts`  | 5            | mismo set                                       |
| **Total**                                                            | **40 specs** | Solapamiento de matriz de error testeada        |

**Los 40 specs prueban el mismo contrato dos veces.** Ejemplo: ambos
prueban "anon actor → blocked + permission" en archivos distintos.

## Estado de uso en producción

| Artefacto                                | Caller real                                                             | Activo en runtime                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `executeAdmitPatientCommand` (pilot)     | `useAdmitPatient` → `CensusTable.saveEmptyBedDemographics`              | **Sí**, `USE_ADMIT_PATIENT_COMMAND=true`                               |
| `executeDischargePatientCommand` (pilot) | `useDischargePatient` (hook existe pero **ningún componente lo llama**) | **No**                                                                 |
| `executeTransferPatientCommand` (pilot)  | `useTransferPatient` (hook existe pero **ningún componente lo llama**)  | **No**                                                                 |
| `dispatchCanonicalDischarge` (facade)    | `useCensusDischargeCommand`                                             | **Solo cuando flag `USE_DISCHARGE_PATIENT_COMMAND=true`**, default OFF |
| `dispatchCanonicalTransfer` (facade)     | `useCensusTransferCommand`                                              | **Solo cuando flag `USE_TRANSFER_PATIENT_COMMAND=true`**, default OFF  |

**Conclusión operacional**: en producción hoy, ni el pilot de discharge/transfer
ni el facade de discharge/transfer están activos. Solo `admit` está canónico-en-prod.

## Búsqueda de imports / referencias

```bash
$ grep -rln "executeDischargePatientCommand\|useDischargePatient" src --include="*.ts" --include="*.tsx" | grep -v test
src/hooks/useDischargePatient.ts
src/application/daily-record/commands/dischargePatientCommand.ts

$ grep -rln "executeTransferPatientCommand\|useTransferPatient" src --include="*.ts" --include="*.tsx" | grep -v test
src/hooks/useTransferPatient.ts
src/application/daily-record/commands/transferPatientCommand.ts
```

Solo se importan a sí mismos + hook adaptador. **Cero callers reales.**

## Opciones para resolver (informa C3)

### Opción A — Eliminar pilots de discharge y transfer

- Borrar `dischargePatientCommand.ts`, `transferPatientCommand.ts`
- Borrar `useDischargePatient.ts`, `useTransferPatient.ts`
- Borrar puertos (`dailyRecordDischargePatientPort.ts`, `dailyRecordTransferPatientPort.ts`)
- Borrar 30 specs asociados
- Actualizar ADR_CANONICAL_WRITE_COMMANDS para citar **solo `admit`** como referencia
- Actualizar ADR_CANONICAL_WRITE_ADOPTION_FACADES para retirar mención de pilots como prior art

**Costo**: ~2-3 horas. Reduce ~600 LOC + 30 specs (~700 LOC total). Refleja la realidad.

### Opción B — Promover pilots a producción

- Expandir input shape de los pilots para cubrir movement metadata (movementDate, dischargeType, target, cribStatus, escort, time…)
- Expandir port para escribir entry rica en `discharges[]` / `transfers[]`
- Migrar `useCensusDischargeCommand` / `useCensusTransferCommand` a usar el pilot completo
- Eliminar facades

**Costo**: ~3-4 días de trabajo + riesgo de regresión clínica. Beneficio: arquitectura más uniforme, pero significativamente más código por mover.

### Opción C — Status quo (no recomendada)

- Mantener ambos
- Documentar explícitamente que pilots son "templates de referencia"
- Aceptar el costo cognitivo + duplicación

**Costo**: cero esfuerzo inmediato. Pero el reportal del próximo auditor verá
los pilots sin uso y descontará nota por sobre-ingeniería.

## Recomendación de este audit

**Opción A** (eliminar pilots de discharge y transfer).

Razones:

1. **No hay caller** ni planeado en el corto plazo. El facade resolvió
   el caso de uso y está en producción (gated, pero esa es operación,
   no código).
2. **Mantener "templates" en producción es deuda**, no abstracción. Si
   se necesita un nuevo write canónico en el futuro, copiar de `admit`
   es trivial (admit ES el único pilot con uso real y por tanto el
   único que merece ser referencia viva).
3. **Reduce 600 LOC y 30 specs** sin perder funcionalidad ni cobertura
   (los facades tienen sus propios specs).
4. **Simplifica el árbol mental** del proyecto. Hoy, ante una nueva
   escritura clínica, hay 3 patrones a evaluar. Tras eliminar, hay 2
   (admit-style canonical command vs adoption facade), y el ADR puede
   articular cuándo usar cada uno con un decision tree de 1 nivel.

## Riesgos de la Opción A

- **Pérdida de "prior art" documentado**: si en 6 meses se decide hacer
  Opción B después de todo, hay que reescribir desde cero. Mitigación:
  el ADR_CANONICAL_WRITE_COMMANDS contiene la plantilla en texto; copiar
  de admit toma menos de una hora.

- **Quedarse sin "ejemplo concreto" para devs nuevos**: hoy el dev nuevo
  ve 3 implementaciones del patrón. Tras Opción A solo ve `admit`.
  Mitigación: `admit` es el más completo y mejor testeado de los 3.

- **Reabrir activos del tracker**: hoy `command-layer-discharge` y
  `command-layer-transfer` están marcados `cerrado`. Si se elimina el
  pilot, técnicamente cambia el sentido del cierre (era "pilot landed",
  ahora sería "facade adoption only"). Mitigación: actualizar la
  descripción del activo cerrado.

## Próximo paso si se acepta la recomendación

Bloque pequeño, bien acotado, ~2 horas:

1. Borrar 6 archivos (3 pilot + 3 hook + 3 puerto)
2. Borrar 6 archivos de tests
3. Actualizar 2 ADRs
4. Actualizar `TECHNICAL_DEBT_REGISTER` para reflejar contexto
5. `npm run check:quality` + `npm run test:ci:unit` verdes
6. Commit único con justificación enlazando este audit
