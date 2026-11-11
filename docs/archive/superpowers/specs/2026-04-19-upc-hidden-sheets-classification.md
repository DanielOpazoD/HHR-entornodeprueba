# UPC Hidden Sheets Classification Design

**Goal:** Hacer que las hojas ocultas del Excel del censo diario registren UPC por subtipo diario `UCI` / `UTI` y, al mismo tiempo, mantengan un total combinado `UPC = UCI + UTI`.

**Architecture:** La clasificación UPC ya existe en el dominio y en la hoja visible del censo diario. La mejora se hará en el pipeline de las hojas ocultas para que usen la clasificación clínica como fuente de verdad, agreguen por paciente los días UCI y UTI por separado, y rendericen el detalle diario con la clasificación de cada fecha sin duplicar la lógica de negocio. La hoja de pacientes conservará una sola fila por paciente; la hoja de detalle diario pasará de mostrar solo presencia UPC a mostrar la clasificación diaria.

**Tech Stack:** TypeScript, ExcelJS, Vitest, workbook builder/renderers ya existentes.

---

## Scope

Este cambio solo ajusta las hojas ocultas del workbook maestro del censo:

- `PACIENTES UPC [MES] [AÑO]`
- `DETALLE DIARIO UPC`

La hoja visible diaria del censo no cambia.

## Success Criteria

- Cada paciente UPC en la hoja oculta de pacientes muestra:
  - un resumen de período,
  - `Días UCI`,
  - `Días UTI`,
  - `Total UPC`.
- La hoja `DETALLE DIARIO UPC` muestra, por día, si la clasificación fue `UCI` o `UTI`.
- `Total UPC` coincide con `Días UCI + Días UTI`.
- Las pruebas de agregación, renderer y sanity del workbook siguen verdes.
- No se introduce una segunda lógica de clasificación separada del dominio existente.

## Risk Rules

- No tocar la hoja visible del censo diario.
- No duplicar la lógica clínica de clasificación; reutilizar la resolución ya existente para UPC.
- Mantener la estructura protegida del workbook y el orden de las hojas ocultas.
- Si una prueba necesita cambiar de contrato, cambiarla en la misma pasada para que el nuevo comportamiento quede explícito.

## File Map

**Aggregation and contracts**

- Modify: `src/services/exporters/excel/censusHiddenSheetsContracts.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsAggregation.ts`

**Rendering**

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

- [ ] **Step 1: Add daily UPC subtype fields to the aggregate model**

The patient aggregate needs to keep the existing bed-history data and also count subtype days independently.

```ts
export interface UpcPatientAggregate {
  key: string;
  patientName: string;
  rut: string;
  age: string;
  diagnosis: string;
  specialty: string;
  admissionDate: string;
  firstSeenDate: string;
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

- [ ] **Step 2: Build the aggregate from the structured UPC classification**

Each logical snapshot should:

```ts
const classification = resolveUpcClassificationFromChecklist(patient.upcChecklist);
if (!classification) return;

const subtype = classification === 'UPC_UCI' ? 'UCI' : 'UTI';
```

Then:

```ts
current.uciDays += subtype === 'UCI' ? 1 : 0;
current.utiDays += subtype === 'UTI' ? 1 : 0;
current.dailyBeds.push({ date: sheet.record.date, bedCode });
```

- [ ] **Step 3: Derive the period label from the counters**

```ts
const resolvePeriodLabel = (uciDays: number, utiDays: number): 'UCI' | 'UTI' | 'Mixto' => {
  if (uciDays > 0 && utiDays > 0) return 'Mixto';
  if (uciDays > 0) return 'UCI';
  return 'UTI';
};
```

- [ ] **Step 4: Lock in the behavior with a focused aggregation test**

Use one patient that appears one day as `UPC_UTI` and another day as `UPC_UCI`, then assert:

```ts
expect(patients).toHaveLength(1);
expect(patients[0].uciDays).toBe(1);
expect(patients[0].utiDays).toBe(1);
expect(patients[0].totalDays).toBe(2);
expect(patients[0].periodLabel).toBe('Mixto');
```

### Task 2: Re-render the hidden UPC sheets with the split counts

**Files:**

- Modify: `src/services/exporters/excel/censusHiddenUpcSheets.ts`
- Modify: `src/services/exporters/excel/censusHiddenSheetsConfig.ts`
- Test: `src/tests/services/censusHiddenSheetsRenderer.test.ts`

- [ ] **Step 1: Expand the patients sheet headers and subtitle**

The hidden patients sheet should add a period classification and the split counters:

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

The subtitle should expose the combined total and the split counts:

```ts
`Pacientes UPC durante el período (pacientes únicos: ${patients.length} | UCI: ${uciDays} | UTI: ${utiDays} | Total UPC: ${uciDays + utiDays})`;
```

- [ ] **Step 2: Render daily detail cells as subtype labels**

The matrix sheet should keep the bed-history column, but each day cell should show the daily UPC subtype:

```ts
cell.value = dailyClassification; // 'UCI' | 'UTI'
cell.fill = dailyClassification === 'UCI' ? solidFill('#C00000') : solidFill('#D6B656');
```

The header note should explain that the daily cells indicate the subtype for that date, not just a generic UPC flag.

- [ ] **Step 3: Update the patient row renderer**

Each patient row should include:

```ts
row.values = [
  index + 1,
  patient.patientName,
  patient.rut,
  patient.age,
  patient.diagnosis,
  patient.specialty,
  patient.periodLabel,
  patient.uciDays,
  patient.utiDays,
  patient.totalDays,
  patient.history,
  formatDateDDMMYYYY(patient.admissionDate),
  patient.daysDetail,
  patient.changedBed ? 'Sí' : 'No',
];
```

- [ ] **Step 4: Protect the new layout with a renderer test**

The renderer test should verify:

```ts
expect(upcSheet.getCell('G5').value).toBe('Mixto');
expect(upcSheet.getCell('H5').value).toBe(1);
expect(upcSheet.getCell('I5').value).toBe(1);
expect(upcSheet.getCell('J5').value).toBe(2);
expect(matrixSheet.getCell('Y5').value).toBe('UCI');
```

### Task 3: Refresh workbook sanity and docs

**Files:**

- Modify: `src/tests/services/censusWorkbookSanity.test.ts`
- Modify: `src/services/exporters/excel/README.md`

- [ ] **Step 1: Update the workbook sanity snapshot**

Keep the workbook structure assertions, but refresh any cell expectations that depend on the new UPC patient-sheet columns or daily detail labels.

- [ ] **Step 2: Update the module README to describe the new hidden-sheet semantics**

Document that:

- the patient sheet now splits UCI and UTI days,
- the daily matrix shows daily subtype labels,
- the combined UPC total remains visible.

- [ ] **Step 3: Run the narrow and broad verifications**

Run:

```bash
npx vitest run src/tests/services/censusHiddenSheetsAggregation.test.ts src/tests/services/censusHiddenSheetsRenderer.test.ts src/tests/services/censusWorkbookSanity.test.ts
npm run typecheck
npm run check:quality
```

Expected:

- all targeted tests pass,
- no type or quality regressions,
- the hidden workbook still opens with the same protected structure.
