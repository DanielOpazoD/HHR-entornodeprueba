# UPC Classification Domain

Pure business logic for classifying hospitalized patients as **UPC-UTI** or **UPC-UCI** per the Hospital Hanga Roa protocol (_Criterios de Clasificación UPC_, April 2026).

## Protocol summary

- **UCI** = at least 1 of: VMI, vasoactivos, inotrópicos (soporte vital avanzado).
- **UTI** = at least 1 of 6 criteria (monitoring/support) without meeting UCI.
- **No UPC** = implicit default for all patients; not stored explicitly.

## Bed eligibility

| Beds      | UPC eligible | UCI eligible                   |
| --------- | ------------ | ------------------------------ |
| R1–R4     | Yes          | Yes                            |
| Neo1–Neo2 | Yes          | **No** (UTI only, protocol §3) |
| H1C1–H6C2 | No           | No                             |

## Algorithm

```
1. Has any UCI criterion?  → UPC_UCI
2. Has any UTI criterion?  → UPC_UTI
3. Otherwise               → null (No UPC)
```

## Data flow

```
UI (UpcChecklistPanel)
 → useUpcChecklistState (draft toggles, memoized classification)
 → useUpcChecklistController (portal positioning, open/close)
 → UpcChecklistPopover (renders portal to document.body)
 → onSave → updatePatientMultiple({ upcChecklist, isUPC })
 → Redux → Firestore
```

## Adding a criterion

1. Add entry to `UPC_UCI_CRITERIA` or `UPC_UTI_CRITERIA` in `upcCriteria.ts`.
2. Use a stable `id` prefixed with `uci_` or `uti_` — this is persisted in Firestore.
3. Tests and validators update automatically (derived from the arrays).

## Tests

```bash
npx vitest run src/tests/domain/upc/ src/tests/shared/census/upcBedPolicy.test.ts src/tests/features/census/
```
