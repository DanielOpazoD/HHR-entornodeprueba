# UPC Hidden Sheets Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que las hojas ocultas del Excel del censo diario registren UPC por subtipo diario `UCI` / `UTI` y mantengan un total combinado `UPC = UCI + UTI`.

**Architecture:** Vamos a tocar solo el pipeline de hojas ocultas. La agregación producirá un view model con conteos por subtipo y clasificación diaria, y el renderer lo presentará en la hoja de pacientes y en la matriz diaria. La hoja visible del censo no cambia, y la clasificación clínica sigue viniendo del dominio UPC ya existente para no duplicar lógica.

**Tech Stack:** TypeScript, ExcelJS, Vitest, existing workbook builder/renderers.

---

## Scope

Este plan modifica únicamente:

- `PACIENTES UPC [MES] [AÑO]`
- `DETALLE DIARIO UPC`

No toca el sheet visible del censo diario.

## Success Criteria

- La hoja de pacientes muestra `Días UCI`, `Días UTI` y `Total UPC`.
- La matriz diaria muestra `UCI` o `UTI` por día.
- `Total UPC` coincide con `Días UCI + Días UTI`.
- Las pruebas de agregación, renderer y workbook sanity siguen verdes.
- No aparece una segunda lógica clínica fuera del dominio UPC existente.

## Risk Rules

- No tocar el workbook visible del censo.
- No inventar una clasificación paralela; reutilizar la resolución UPC del dominio.
- Mantener la protección del workbook y el orden de las hojas ocultas.
- Si un contrato cambia, ajustar los tests en la misma pasada.

## File Map

**Aggregation and contracts**

- Modify: `src/services/exporters/excel/censusHiddenSheetsContracts.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsAggregation.ts`

**Rendering and labels**

- Modify: `src/services/exporters/excel/censusHiddenUpcSheets.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsConfig.ts`

**Tests**

- Modify: `src/tests/services/censusHiddenSheetsAggregation.test.ts`
- Modify: `src/tests/services/censusHiddenSheetsRenderer.test.ts`
- Modify: `src/tests/services/censusWorkbookSanity.test.ts`

**Docs**

- Modify: `src/services/exporters/excel/README.md`

---

### Task 1: Extend the UPC hidden-sheet view model

**Files:**

- Modify: `src/services/exporters/excel/censusHiddenSheetsContracts.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsAggregation.ts`
- Test: `src/tests/services/censusHiddenSheetsAggregation.test.ts`

- [ ] **Step 1: Write the failing aggregation test**

Add a regression where the same patient appears one day as `UPC_UTI` and another day as `UPC_UCI`:

```ts
const firstDay = buildRecord('2026-03-24', {
  R1: buildPatient('R1', {
    patientName: 'Paciente UPC',
    rut: '12.345.678-9',
    upcChecklist: {
      classification: 'UPC_UTI',
      uciCriteria: [],
      utiCriteria: ['uti_mon_cardiaca'],
      evaluatedAt: '2026-04-18T10:00:00Z',
    },
  }),
});

const secondDay = buildRecord('2026-03-25', {
  R1: buildPatient('R1', {
    patientName: 'Paciente UPC',
    rut: '12.345.678-9',
    upcChecklist: {
      classification: 'UPC_UCI',
      uciCriteria: ['uci_vmi'],
      utiCriteria: [],
      evaluatedAt: '2026-04-18T11:00:00Z',
    },
  }),
});

expect(patients[0].uciDays).toBe(1);
expect(patients[0].utiDays).toBe(1);
expect(patients[0].totalDays).toBe(2);
expect(patients[0].periodLabel).toBe('Mixto');
```

- [ ] **Step 2: Run the focused test to confirm it fails**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsAggregation.test.ts -t "aggregates UPC patients across UCI and UTI days"
```

Expected:

- FAIL, because the aggregate model does not yet carry `uciDays` / `utiDays` / `periodLabel`.

- [ ] **Step 3: Add the new aggregate fields and classification counters**

Introduce the new shape in the contracts and update the aggregator to count subtype days from the existing UPC classification:

```ts
export interface UpcPatientAggregate {
  // existing identity/history fields
  dailyBeds: Array<{ date: string; bedCode: string }>;
  uciDays: number;
  utiDays: number;
}

export interface UpcPatientPresentation extends UpcPatientAggregate {
  totalDays: number;
  daysDetail: string;
  history: string;
  changedBed: boolean;
  periodLabel: 'UCI' | 'UTI' | 'Mixto';
}
```

Use the structured checklist classification as the source of truth:

```ts
const classification = resolveUpcClassificationFromChecklist(patient.upcChecklist);
if (!classification) return;

const subtype = classification === 'UPC_UCI' ? 'UCI' : 'UTI';
current.uciDays += subtype === 'UCI' ? 1 : 0;
current.utiDays += subtype === 'UTI' ? 1 : 0;
```

- [ ] **Step 4: Re-run the focused aggregation test**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsAggregation.test.ts -t "aggregates UPC patients across UCI and UTI days"
```

Expected:

- PASS, with one aggregated patient and split subtype counters.

- [ ] **Step 5: Commit the aggregation/model change**

```bash
git add src/services/exporters/excel/censusHiddenSheetsContracts.ts src/services/exporters/excel/censusHiddenSheetsAggregation.ts src/tests/services/censusHiddenSheetsAggregation.test.ts
git commit -m "feat: split UPC hidden sheet counts by subtype"
```

### Task 2: Re-render the hidden UPC sheets with the split counts

**Files:**

- Modify: `src/services/exporters/excel/censusHiddenUpcSheets.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsConfig.ts`
- Test: `src/tests/services/censusHiddenSheetsRenderer.test.ts`

- [ ] **Step 1: Write the failing renderer test**

Assert that the patients sheet now shows subtype totals and that the matrix shows daily `UCI` / `UTI` labels:

```ts
expect(upcSheet.getCell('G5').value).toBe('Mixto');
expect(upcSheet.getCell('H5').value).toBe(1);
expect(upcSheet.getCell('I5').value).toBe(1);
expect(upcSheet.getCell('J5').value).toBe(2);
expect(matrixSheet.getCell('Y5').value).toBe('UCI');
```

- [ ] **Step 2: Run the focused renderer test to confirm it fails**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts
```

Expected:

- FAIL, because the renderer still writes the old columns and bed-code-only matrix cells.

- [ ] **Step 3: Update the UPC sheet layout and matrix labels**

Render the patients sheet with the extra period classification and split counters:

```ts
const UPC_HEADERS: Array<string | number> = [
  '#',
  'Paciente',
  'RUT',
  'Edad',
  'Diagnóstico',
  'Especialidad',
  'Clasif. período',
  'Días UCI',
  'Días UTI',
  'Total UPC',
  'Cama / Historial',
  'F. Ingreso',
  'Detalle Días UPC',
  'Cambio Cama',
];
```

Render the matrix so each day cell shows the subtype instead of the bed code:

```ts
cell.value = dailyClassification; // 'UCI' | 'UTI'
cell.fill = dailyClassification === 'UCI' ? solidFill('#C00000') : solidFill('#D6B656');
```

Keep the bed history in the rightmost column so the row still explains movement across beds.

- [ ] **Step 4: Re-run the renderer test**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsRenderer.test.ts
```

Expected:

- PASS, with the new UPC columns and per-day subtype labels rendered.

- [ ] **Step 5: Commit the renderer change**

```bash
git add src/services/exporters/excel/censusHiddenUpcSheets.ts src/services/exporters/excel/censusHiddenSheetsConfig.ts src/tests/services/censusHiddenSheetsRenderer.test.ts
git commit -m "feat: render UPC subtype counts in hidden sheets"
```

### Task 3: Refresh workbook sanity and docs

**Files:**

- Modify: `src/tests/services/censusWorkbookSanity.test.ts`
- Modify: `src/services/exporters/excel/README.md`

- [ ] **Step 1: Update the workbook sanity snapshot**

Refresh any assertions that depend on the UPC sheet headers or the daily matrix cell values. Keep the workbook structure checks intact:

```ts
expect(summarySheet?.getCell('A1').value).toBe(
  'RESUMEN CENSO DIARIO — HOSPITAL HANGA ROA — MARZO 2026'
);
expect(upcSheet?.getCell('A1').value).toBe(
  'REGISTRO PACIENTES UPC — HOSPITAL HANGA ROA — MARZO 2026'
);
expect(matrixSheet?.getCell('A4').value).toBe('Paciente');
```

- [ ] **Step 2: Update the README for the hidden-sheet contract**

Document that:

- the patients sheet splits UCI and UTI days,
- the daily matrix now shows daily subtype labels,
- the combined UPC total remains visible.

- [ ] **Step 3: Run the narrow verification set**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsAggregation.test.ts src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookSanity.test.ts
```

Expected:

- all three suites pass.

- [ ] **Step 4: Run the full safety gates**

Run:

```bash
npm run typecheck
npm run check:quality
```

Expected:

- both commands exit `0`.

- [ ] **Step 5: Commit the final workbook refresh**

```bash
git add src/tests/services/censusWorkbookSanity.test.ts src/services/exporters/excel/README.md
git commit -m "docs: refresh UPC hidden sheet workbook contract"
```

## Self-Review

- Spec coverage: aggregation, renderer, workbook sanity, and docs are all mapped to explicit tasks.
- Placeholder scan: no TBD or vague steps.
- Type consistency: the plan uses one aggregated patient model with `uciDays`, `utiDays`, `totalDays`, and `periodLabel`.
