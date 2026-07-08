# Política de auditoría de mutaciones clínicas

**Estado:** Vigente (2026-06-26)
**Gate:** `check:clinical-mutation-audit-policy` (en `check:quality`)
**Fuente declarada:** [`scripts/clinical-mutation-audit-policy.json`](../scripts/clinical-mutation-audit-policy.json)

## Por qué existe

La autorización server-side de las mutaciones vive en las **Firestore rules** (cada path clínico se
escribe sólo con el predicado correcto: `isAdmin()`, `canEdit()`, `canWriteClinicalDocument()`, …).
Lo que esta política gobierna es la otra mitad del contrato clínico: **cómo se audita cada
mutación**, para que un cambio sobre datos clínicos nunca quede sin rastro de forma accidental.

El disparador fue un hallazgo real: `executeWriteAuditEvent` **no lanza** — devuelve un
`ApplicationOutcome` (`success` | `failed`, p.ej. `failed` para actor anónimo). Código que lo
`await`-eaba e ignoraba el resultado dejaba caer fallos de auditoría en silencio
(`CONFLICT_VERSION_RESTORED`, `CONFLICT_AUTO_MERGED`). En vez de arreglar caso a caso, declaramos la
postura de **cada** `AuditAction` y la enforzamos con un gate.

## Las dos arquitecturas de auditoría (contexto)

| Camino                                                                  | Semántica de fallo                                                                                                                        | Uso típico                                                 |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `executeWriteAuditEvent` (`@/application/audit/writeAuditEventUseCase`) | Devuelve `ApplicationOutcome`; **rechaza actor anónimo**. El caller decide.                                                               | Commands / use-cases (restore, discharge, transfer, admit) |
| `logAuditEvent` / `auditPort.writeEvent` (`@/services/admin/auditCore`) | **Local-first**: persiste local y sincroniza a Firestore best-effort; los errores remotos se observan dentro de `auditCore` (no relanza). | Ediciones de censo de alta frecuencia, vistas              |

Ninguna es "mejor": son decisiones distintas. La política sólo exige que la elección sea
**explícita** por acción.

## Las posturas

- **`failClosed`** — la mutación **debe abortar** si su auditoría no se puede escribir. Reservada
  para sobrescrituras/borrados de administrador donde un cambio sin auditar es inaceptable **y**
  abortar es seguro (no urgente, reversible). Ej.: `CONFLICT_VERSION_RESTORED`, los borrados de
  registro clínico (`DAILY_RECORD_DELETED`, `CLINICAL_DOCUMENT_DELETED`),
  `MEDICAL_INDICATION_TEMPLATE_*`. Enlaza un `test` probatorio.
- **`bestEffortObservable`** — la mutación **procede** aunque la auditoría falle, pero el fallo se
  **superficializa** (outcome degradado, telemetría, o el log local-first auto-observado). Reservada
  para acciones de **flujo clínico urgente** donde abortar dañaría la atención (admitir, dar de alta,
  trasladar, cargar en el censo). Requiere `justification`.
- **`exemptNonMutation`** — vistas, login/logout, exportaciones/impresiones (salida/acceso) y eventos
  de sistema que **no mutan** estado clínico; no requieren auditoría fail-closed.
- **`serverSideEnforced`** — emitida/enforzada server-side en una Cloud Function (`{ action, emitter }`);
  el gate exige que el archivo `functions/` del emisor exista (no hay test cliente que enlazar).

## El gate

`check:clinical-mutation-audit-policy` ([`scripts/check-clinical-mutation-audit-policy.mjs`](../scripts/check-clinical-mutation-audit-policy.mjs))
tiene **dos enforcements**:

**A. Declaración (registro).** Lee el union `AuditAction` y la política, y **falla** si:

1. una `AuditAction` no está clasificada (fuerza decidir su postura antes de mergear);
2. una acción aparece en más de un bucket;
3. una entrada `bestEffortObservable` no trae `justification`;
4. la política declara una acción que ya no existe en el union (entrada obsoleta);
5. una acción `failClosed` no enlaza un `test` probatorio existente (`src/tests/**/*.test.ts`);
6. una acción `serverSideEnforced` no enlaza un `emitter` existente bajo `functions/`.

**B. Cumplimiento (outcome no descartado).** Escanea `src/` (excluyendo tests) y **falla** si algún
llamado a `executeWriteAuditEvent(...)` descarta su `ApplicationOutcome` (statement que arranca con
el call, con o sin `await`/`void`). Ese es el bug exacto que reapareció en #129/#130: como
`executeWriteAuditEvent` **no lanza**, un outcome ignorado deja caer el fallo en silencio. El emisor
debe capturar e inspeccionar el outcome (o pasarlo por un helper fail-closed).

Cubierto por `src/tests/build/clinicalMutationAuditPolicyScript.test.ts`: test de no-drift del
registro real + tests del detector (atrapa el `await` desnudo / `void`, acepta asignación/return).

## Limitaciones (qué NO verifica)

Para no dar **falsa confianza**, conviene ser explícito sobre el alcance:

- **El gate exige que cada `failClosed` enlace un `test` existente, pero no verifica su _semántica_.**
  Cada entrada `failClosed` es `{ action, test }` y el gate confirma que el archivo de test exista —
  ya no se puede declarar `failClosed` sin apuntar a una prueba. Lo que el gate **no** hace es
  verificar que ese test realmente demuestre el abort (que el emisor audite-primero y no mute si la
  auditoría falla); eso queda en el propio test + revisión humana. **`serverSideEnforced` tiene el
  mismo límite:** el gate confirma que el archivo `emitter` (`functions/`) exista, no que esa Cloud
  Function audite correctamente.
- **No detecta el call vía alias.** Si el `executeWriteAuditEvent` se invoca a través de un alias
  inyectado (`deps.writeAuditEvent ?? executeWriteAuditEvent`), el escaneo sintáctico no lo ve; hoy
  esos consumidores capturan el outcome, pero es un punto ciego conocido.
- **No detecta una mutación clínica que no emita _ninguna_ `AuditAction`.** El gate gobierna las
  acciones declaradas; una escritura clínica nueva sin evento de auditoría es invisible aquí (queda
  para revisión humana / las rules + cobertura crítica).
- **Las posturas son políticas declaradas**, no todas verificadas contra su emisor. Las verificadas
  este ciclo se listan abajo; el resto es intención declarada hasta que se audite su emisor.

## Cómo agregar una `AuditAction` nueva

1. Agrega el literal al union en `src/types/auditActionTypes.ts`.
2. Clasifícalo en `scripts/clinical-mutation-audit-policy.json` (`justification` si es
   `bestEffortObservable`; `{ action, test }` apuntando a su test probatorio si es `failClosed`).
3. Asegura que el emisor cumpla la postura declarada (fail-closed → auditar-primero, verificar el
   outcome y **abortar antes de mutar**).

## Verificación de las posturas `failClosed`

Se auditaron los emisores de las 14 acciones declaradas `failClosed`. Resultado: solo **7** eran
realmente fail-closed; las otras 7 se **reclasificaron** tras verificar el emisor.

**`failClosed` (9, verificadas + con test probatorio enlazado):**

- `CONFLICT_VERSION_RESTORED`, `PRESCRIPTION_MANUAL_DELETED` — audit-first; abortan si la auditoría falla.
- `MEDICAL_INDICATION_RECORD_CREATED` — atómico (`createWithAuditEvent`: registro + auditoría en un
  solo `runBatch`).
- `MEDICAL_INDICATION_TEMPLATE_{CREATED,UPDATED,ARCHIVED,USED}` — **reordenadas a audit-first** (antes
  mutaban y luego asertaban; ahora abortan antes de mutar).
- `CLINICAL_DOCUMENT_DELETED`, `DAILY_RECORD_DELETED` — **Scope C**: re-plumbeadas a use-cases
  audit-first (`executeDeleteClinicalDocument`, `executeDeleteDailyRecord`). Ya no se borra un
  registro clínico sin auditoría garantizada; el logger fire-and-forget del hook se retiró.

**Reclasificadas a `bestEffortObservable`** (emisor fire-and-forget del hook `useAudit`; el outcome se
reporta por telemetría pero la mutación no se bloquea):

- `PATIENT_CLEARED`, `CLINICAL_EVENT_DELETED`, `MEDICAL_HANDOFF_RESTORED`.
- `PRESCRIPTION_RETENTION_DELETED` — reservada: sin emisor actual (retención server-side futura).

**`serverSideEnforced`:** `STATISTICAL_SPECIALTY_RECLASSIFIED` — emitida en
`functions/lib/minsal/minsalReclassifications.js`.

Ciclo previo: `CONFLICT_AUTO_MERGED` y `PATIENT_HARMONIZED` quedaron `bestEffortObservable` con su
outcome superficializado.
